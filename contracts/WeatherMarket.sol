// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ─── Tempo 原生功能介面 ────────────────────────────────────────────────────────
//
// IScheduler：Tempo Scheduled Transactions 預編譯
//   - 實際地址請至 https://docs.tempo.xyz/precompiles 確認後填入建構子
//   - 測試時傳入 address(0) 即可停用，改為手動呼叫 lockMarket()
//
interface IScheduler {
    /// @param target   被呼叫的合約地址
    /// @param callData ABI-encoded 函式呼叫
    /// @param executeAt UNIX timestamp，Tempo 網路在此時間點自動送出 tx
    /// @return taskId  可用於取消排程
    function schedule(
        address target,
        bytes calldata callData,
        uint256 executeAt
    ) external returns (bytes32 taskId);

    function cancel(bytes32 taskId) external;
}

// ─────────────────────────────────────────────────────────────────────────────

contract WeatherMarket is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // testnet: pathUSD，mainnet: USDC.e
    IERC20 public immutable stablecoin;

    address public oracle;
    address public scheduler; // Tempo Scheduler 預編譯地址，address(0) = 停用

    uint256 public constant FEE_BPS = 200; // 2% 市場手續費

    // MPP: oracle 呼叫 submitResult 時須支付此費用（pathUSD）
    uint256 public oracleFee;

    uint256 public collectedFees;

    // Fee Sponsorship: 合約代墊 gas 的 pathUSD 儲備
    uint256 public gasTankBalance;

    uint256 public nextMarketId;

    enum Status {
        OPEN,
        LOCKED,
        SETTLED
    }

    struct Market {
        string city;
        string predictionType;  // e.g. "HIGH_TEMP" / "LOW_TEMP" / "RAINFALL"
        uint256 targetDate;
        uint256 lockTime;
        Status status;
        uint256 totalPool;
        int256 finalTemp;       // 單位：攝氏 * 10（保留一位小數，例如 315 = 31.5°C）
        uint8 winningBucket;
        int256[] buckets;       // 溫度區間上界陣列，嚴格遞增
        bool noWinner;
        // Payment Memo
        string settleMemo;      // 格式："{city}/{predictionType}/{finalValue}/{WIN|NO_WINNER}"
        // Scheduled Transactions
        bytes32 lockTaskId;     // Tempo Scheduler 給的 lockMarket task ID
    }

    // MPP: 每筆結算的回執
    struct SettlementReceipt {
        uint256 marketId;
        int256 finalTemp;
        uint8 winningBucket;
        bool noWinner;
        string memo;
        uint256 timestamp;
        address submittedBy;
    }

    mapping(uint256 => mapping(uint8 => mapping(address => uint256))) public bets;
    mapping(uint256 => mapping(uint8 => uint256)) public bucketTotals;
    mapping(uint256 => mapping(address => uint256)) public userTotalBets;
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(uint256 => Market) private _markets;
    mapping(uint256 => SettlementReceipt) private _receipts;

    // Fee Sponsorship: 已授權可代送交易的 relayer 地址
    mapping(address => bool) public approvedRelayers;

    // ─── Events ───────────────────────────────────────────────────────────────

    event MarketCreated(
        uint256 indexed marketId,
        string city,
        string predictionType,
        uint256 targetDate,
        uint256 lockTime,
        uint256 bucketCount
    );
    event BetPlaced(
        uint256 indexed marketId,
        address indexed bettor,
        uint8 bucket,
        uint256 amount
    );
    event MarketLocked(uint256 indexed marketId);
    event ResultSubmitted(
        uint256 indexed marketId,
        int256 finalTemp,
        uint8 winningBucket,
        bool noWinner,
        string memo             // Payment Memo
    );
    event WinningsClaimed(
        uint256 indexed marketId,
        address indexed user,
        uint256 amount
    );
    event FeesWithdrawn(address indexed to, uint256 amount);
    event OracleUpdated(address indexed newOracle);
    event SchedulerUpdated(address indexed newScheduler);
    event OracleFeeUpdated(uint256 newFee);
    event GasTankDeposited(address indexed by, uint256 amount);
    event GasTankWithdrawn(address indexed to, uint256 amount);
    event RelayerUpdated(address indexed relayer, bool approved);
    event ScheduledLock(uint256 indexed marketId, bytes32 taskId);
    event SettlementExecuted(
        uint256 indexed marketId,
        string  city,
        int256  tempOpenWeather,
        int256  tempWeatherApi,
        int256  tempOpenMeteo,
        int256  medianTemp,
        uint8   winningBucket,
        bool    noWinner,
        uint256 totalPool
    );

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOracle() {
        require(msg.sender == oracle, "WeatherMarket: not oracle");
        _;
    }

    modifier onlyRelayer() {
        require(approvedRelayers[msg.sender], "WeatherMarket: not relayer");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _stablecoin  pathUSD (testnet) 或 USDC.e (mainnet) 地址
    /// @param _oracle      可呼叫 submitResult 的 oracle 地址
    /// @param _scheduler   Tempo Scheduler 預編譯地址；address(0) = 停用自動排程
    /// @param _oracleFee   MPP 費用（pathUSD，18 decimals）；0 = 免費
    constructor(
        address _stablecoin,
        address _oracle,
        address _scheduler,
        uint256 _oracleFee
    ) Ownable(msg.sender) {
        require(_stablecoin != address(0), "WeatherMarket: zero stablecoin");
        require(_oracle != address(0), "WeatherMarket: zero oracle");
        stablecoin = IERC20(_stablecoin);
        oracle = _oracle;
        scheduler = _scheduler;
        oracleFee = _oracleFee;
    }

    // ─── 管理函式 ─────────────────────────────────────────────────────────────

    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "WeatherMarket: zero oracle");
        oracle = _oracle;
        emit OracleUpdated(_oracle);
    }

    /// @notice 更新 Tempo Scheduler 預編譯地址；address(0) 停用自動排程
    function setScheduler(address _scheduler) external onlyOwner {
        scheduler = _scheduler;
        emit SchedulerUpdated(_scheduler);
    }

    /// @notice MPP: 更新呼叫 submitResult 所需的 pathUSD 費用
    function setOracleFee(uint256 _fee) external onlyOwner {
        oracleFee = _fee;
        emit OracleFeeUpdated(_fee);
    }

    /// @notice Fee Sponsorship: 設定可代送下注交易的 relayer 白名單
    function setRelayer(address relayer, bool approved) external onlyOwner {
        approvedRelayers[relayer] = approved;
        emit RelayerUpdated(relayer, approved);
    }

    // ─── Fee Sponsorship: Gas Tank ────────────────────────────────────────────

    /// @notice owner 向 gas tank 注入 pathUSD（供 relayer 代墊 gas 用）
    function depositGasTank(uint256 amount) external onlyOwner {
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        gasTankBalance += amount;
        emit GasTankDeposited(msg.sender, amount);
    }

    function withdrawGasTank(uint256 amount) external onlyOwner {
        require(amount <= gasTankBalance, "WeatherMarket: insufficient gas tank");
        gasTankBalance -= amount;
        stablecoin.safeTransfer(owner(), amount);
        emit GasTankWithdrawn(owner(), amount);
    }

    // ─── 建立市場 ─────────────────────────────────────────────────────────────

    /// @param city            城市名稱，e.g. "Tokyo"
    /// @param predictionType  預測類型，e.g. "HIGH_TEMP"
    /// @param targetDate      實際氣象數據的日期（UNIX timestamp）
    /// @param buckets         溫度區間上界，嚴格遞增，e.g. [25,28,31,34]
    /// @param lockTime        停止下注的時間；必須 > block.timestamp 且 < targetDate
    function createMarket(
        string calldata city,
        string calldata predictionType,
        uint256 targetDate,
        int256[] calldata buckets,
        uint256 lockTime
    ) external onlyOwner returns (uint256 marketId) {
        require(buckets.length > 0, "WeatherMarket: empty buckets");
        require(buckets.length <= 253, "WeatherMarket: too many buckets");
        require(lockTime > block.timestamp, "WeatherMarket: lockTime in past");
        require(targetDate > lockTime, "WeatherMarket: targetDate before lockTime");

        for (uint256 i = 1; i < buckets.length; i++) {
            require(buckets[i] > buckets[i - 1], "WeatherMarket: buckets not sorted");
        }

        marketId = nextMarketId++;
        Market storage m = _markets[marketId];
        m.city = city;
        m.predictionType = predictionType;
        m.targetDate = targetDate;
        m.lockTime = lockTime;
        m.status = Status.OPEN;
        m.buckets = buckets;

        // Scheduled Transactions: 在 lockTime 自動呼叫 lockMarket(marketId)
        if (scheduler != address(0)) {
            bytes memory callData = abi.encodeCall(this.lockMarket, (marketId));
            bytes32 taskId = IScheduler(scheduler).schedule(address(this), callData, lockTime);
            m.lockTaskId = taskId;
            emit ScheduledLock(marketId, taskId);
        }

        emit MarketCreated(marketId, city, predictionType, targetDate, lockTime, buckets.length + 1);
    }

    // ─── 下注 ─────────────────────────────────────────────────────────────────

    /// @notice 使用者直接下注，自行付 gas
    function placeBet(uint256 marketId, uint8 bucket, uint256 amount) external {
        _placeBet(marketId, bucket, amount, msg.sender);
    }

    /// @notice Fee Sponsorship: relayer 代替 bettor 送出下注
    ///         bettor 需事先對合約 approve 足夠的 pathUSD
    ///         gas 費用由 relayer（搭配 gasTank）承擔，bettor 只需持有 pathUSD
    function placeBetFor(
        uint256 marketId,
        uint8 bucket,
        uint256 amount,
        address bettor
    ) external onlyRelayer {
        _placeBet(marketId, bucket, amount, bettor);
    }

    function _placeBet(
        uint256 marketId,
        uint8 bucket,
        uint256 amount,
        address bettor
    ) internal {
        Market storage m = _markets[marketId];
        require(m.status == Status.OPEN, "WeatherMarket: not open");
        require(block.timestamp < m.lockTime, "WeatherMarket: past lock time");
        require(bucket <= uint8(m.buckets.length), "WeatherMarket: invalid bucket");
        require(amount > 0, "WeatherMarket: zero amount");

        stablecoin.safeTransferFrom(bettor, address(this), amount);

        bets[marketId][bucket][bettor] += amount;
        bucketTotals[marketId][bucket] += amount;
        userTotalBets[marketId][bettor] += amount;
        m.totalPool += amount;

        emit BetPlaced(marketId, bettor, bucket, amount);
    }

    // ─── 鎖定市場 ─────────────────────────────────────────────────────────────

    /// @notice lockTime 到後可由任何人（或 Tempo Scheduler）呼叫
    function lockMarket(uint256 marketId) external {
        Market storage m = _markets[marketId];
        require(m.status == Status.OPEN, "WeatherMarket: not open");
        require(block.timestamp >= m.lockTime, "WeatherMarket: lock time not reached");
        m.status = Status.LOCKED;
        emit MarketLocked(marketId);
    }

    // ─── MPP: 結算 ────────────────────────────────────────────────────────────

    /// @notice MPP endpoint：oracle 呼叫此函式提交氣象結果並完成結算
    ///         若 oracleFee > 0，oracle 需在呼叫前 approve 合約扣款
    /// @param marketId  目標市場 ID
    /// @param finalTemp 實際溫度 * 10，e.g. 315 = 31.5°C
    /// @param memo      Payment Memo，格式建議："{city}/{predictionType}/{finalTemp}/{outcome}"
    ///                  e.g. "Tokyo/HIGH_TEMP/315/WIN"
    /// @return receipt  結算回執，可存入資料庫或回傳給呼叫方
    function submitResult(
        uint256 marketId,
        int256 finalTemp,
        string calldata memo
    ) external onlyOracle returns (SettlementReceipt memory receipt) {
        // MPP: 收取 oracle 服務費
        if (oracleFee > 0) {
            stablecoin.safeTransferFrom(msg.sender, address(this), oracleFee);
            collectedFees += oracleFee;
        }

        Market storage m = _markets[marketId];
        require(m.status == Status.LOCKED, "WeatherMarket: not locked");

        uint8 winning = _determineWinningBucket(m.buckets, finalTemp);
        bool noWinner = bucketTotals[marketId][winning] == 0;

        m.finalTemp = finalTemp;
        m.winningBucket = winning;
        m.noWinner = noWinner;
        m.status = Status.SETTLED;
        m.settleMemo = memo; // Payment Memo

        emit SettlementExecuted(
            marketId,
            m.city,
            0,   // tempOpenWeather — 三源值由 memo 攜帶，event 欄位保留供未來升級
            0,   // tempWeatherApi
            0,   // tempOpenMeteo
            finalTemp,
            winning,
            noWinner,
            m.totalPool
        );

        // 只在有得獎者時收市場手續費
        if (!noWinner) {
            collectedFees += (m.totalPool * FEE_BPS) / 10000;
        }

        // MPP: 建立結算回執
        receipt = SettlementReceipt({
            marketId: marketId,
            finalTemp: finalTemp,
            winningBucket: winning,
            noWinner: noWinner,
            memo: memo,
            timestamp: block.timestamp,
            submittedBy: msg.sender
        });
        _receipts[marketId] = receipt;

        emit ResultSubmitted(marketId, finalTemp, winning, noWinner, memo);
    }

    // ─── 領取獎金 ─────────────────────────────────────────────────────────────

    function claimWinnings(uint256 marketId) external nonReentrant {
        Market storage m = _markets[marketId];
        require(m.status == Status.SETTLED, "WeatherMarket: not settled");
        require(!claimed[marketId][msg.sender], "WeatherMarket: already claimed");

        uint256 payout;

        if (m.noWinner) {
            payout = userTotalBets[marketId][msg.sender];
            require(payout > 0, "WeatherMarket: no bets to refund");
        } else {
            uint8 winning = m.winningBucket;
            uint256 userBet = bets[marketId][winning][msg.sender];
            require(userBet > 0, "WeatherMarket: no winning bet");
            uint256 netPool = m.totalPool - (m.totalPool * FEE_BPS) / 10000;
            payout = (userBet * netPool) / bucketTotals[marketId][winning];
        }

        claimed[marketId][msg.sender] = true;
        stablecoin.safeTransfer(msg.sender, payout);
        emit WinningsClaimed(marketId, msg.sender, payout);
    }

    // ─── 提取手續費 ───────────────────────────────────────────────────────────

    function withdrawFees() external onlyOwner {
        uint256 amount = collectedFees;
        require(amount > 0, "WeatherMarket: no fees");
        collectedFees = 0;
        stablecoin.safeTransfer(owner(), amount);
        emit FeesWithdrawn(owner(), amount);
    }

    // ─── 查詢函式 ─────────────────────────────────────────────────────────────

    function getMarket(uint256 marketId)
        external
        view
        returns (
            string memory city,
            string memory predictionType,
            uint256 targetDate,
            uint256 lockTime,
            Status status,
            uint256 totalPool,
            int256 finalTemp,
            uint8 winningBucket,
            int256[] memory buckets,
            bool noWinner,
            string memory settleMemo
        )
    {
        Market storage m = _markets[marketId];
        return (
            m.city,
            m.predictionType,
            m.targetDate,
            m.lockTime,
            m.status,
            m.totalPool,
            m.finalTemp,
            m.winningBucket,
            m.buckets,
            m.noWinner,
            m.settleMemo
        );
    }

    /// @notice MPP: 取得指定市場的結算回執
    function getReceipt(uint256 marketId) external view returns (SettlementReceipt memory) {
        require(_markets[marketId].status == Status.SETTLED, "WeatherMarket: not settled");
        return _receipts[marketId];
    }

    // ─── 內部函式 ─────────────────────────────────────────────────────────────

    function _determineWinningBucket(
        int256[] storage buckets,
        int256 temp
    ) internal view returns (uint8) {
        for (uint8 i = 0; i < uint8(buckets.length); i++) {
            if (temp <= buckets[i]) return i;
        }
        return uint8(buckets.length);
    }
}
