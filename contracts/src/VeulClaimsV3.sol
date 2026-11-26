// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice Minimal ERC-20 surface used here.
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title VeulClaimsV3
/// @notice Pays out Veul's daily paybacks. Every verified swap on Veul owes its trader 0.25% of the trade in USDG
/// (recorded offchain in the ledger). Once a day an automated *poster* key posts a Merkle root over every trader's
/// *cumulative* owed amount; the owner funds this contract with USDG. A trader claims the difference between their
/// cumulative amount and what they already claimed, either as USDG or swapped into the stock token they picked.
///
/// Roots are posted by a separate *poster* key that lives on a server, so they can come daily without the owner key
/// leaving the owner's wallet. The poster can do nothing else, and is limited: each of its roots may raise the total
/// by at most `maxIncrease`, at most one of its roots per `minInterval`, none while paused.
///
/// Those limits bound the *total*, not who gets it: a root is a list of amounts the contract cannot check, so a
/// stolen poster key can post a root that gives one wallet everything (found in the 2026-11-26 review of v2).
/// What bounds the loss is the payout budget (new in v3): every claim, by anyone, spends from one budget that holds
/// at most `maxPayout` and refills evenly over `payoutWindow`. Over any span of time t, at most
/// maxPayout + maxPayout * t / payoutWindow can leave, whatever root is live, until the owner pauses. A claim larger
/// than the budget left is paid in part; the rest stays claimable when the budget refills.
///
/// Safety properties:
/// - A root is only accepted if this contract holds enough USDG for every cumulative amount in it.
/// - The owner can never take out USDG that is still claimable (`rescue` only releases the excess).
/// - For a claim with a swap, exactly the claimed USDG is sent to the Uniswap Universal Router, which has no
///   allowance on this contract; the router must use all of it, and the claimer must receive at least `minOut` of
///   the stock. A bad route can only affect the claimer's own amount, never anyone else's.
contract VeulClaimsV3 {
    // ----------------------------------------------------------------------------------------------------------------
    // Immutable setup
    // ----------------------------------------------------------------------------------------------------------------

    /// @notice The token paybacks are owed in (USDG, 6 decimals, on Robinhood Chain).
    IERC20 public immutable usdg;
    /// @notice Uniswap Universal Router that performs the USDG → stock swap.
    address public immutable router;

    // ----------------------------------------------------------------------------------------------------------------
    // State
    // ----------------------------------------------------------------------------------------------------------------

    address public owner;
    address public pendingOwner;
    bool public paused;

    /// @notice The automated key that may post roots within the limits below (zero = none).
    address public poster;
    /// @notice Most a poster's root may raise `rootTotal` by (USDG base units).
    uint256 public maxIncrease;
    /// @notice Least time between two of the poster's roots (seconds), measured from the last root of anyone.
    uint64 public minInterval;
    /// @notice When the last root was posted (unix seconds).
    uint64 public lastPostedAt;

    /// @notice Most USDG the payout budget holds (USDG base units). Zero until the owner sets it: no claims before.
    uint256 public maxPayout;
    /// @notice How long the budget takes to refill from empty to `maxPayout` (seconds).
    uint64 public payoutWindow;
    /// @notice When the budget was last brought up to date (unix seconds).
    uint64 public budgetUpdatedAt;
    /// @dev The budget as of `budgetUpdatedAt`; read the live value with `payoutBudget()`.
    uint256 private budget;

    /// @notice Current Merkle root over (wallet, cumulative owed USDG) leaves.
    bytes32 public root;
    /// @notice Sum of every cumulative amount in the current root.
    uint256 public rootTotal;
    /// @notice How many roots have been posted (1 after the first).
    uint256 public epoch;
    /// @notice USDG paid out so far, over all wallets.
    uint256 public totalClaimed;
    /// @notice USDG paid out so far, per wallet.
    mapping(address wallet => uint256 amount) public claimed;

    uint256 private locked = 1;

    // ----------------------------------------------------------------------------------------------------------------
    // Events and errors
    // ----------------------------------------------------------------------------------------------------------------

    event RootPosted(uint256 indexed epoch, bytes32 root, uint256 total, address indexed by);
    event PosterSet(address indexed poster);
    event LimitsSet(uint256 maxIncrease, uint64 minInterval);
    event PayoutLimitSet(uint256 maxPayout, uint64 payoutWindow);
    event Claimed(address indexed wallet, uint256 amount, uint256 cumulative, address indexed outToken, uint256 outAmount);
    event Paused(bool paused);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    error NotOwner();
    error NotPoster();
    error IncreaseTooLarge(uint256 increase, uint256 maxIncrease);
    error TooSoon(uint256 nextAllowedAt);
    error PayoutBudgetEmpty();
    error WindowTooShort();
    error PayoutLimitTooLarge();
    error IsPaused();
    error Reentrancy();
    error ZeroAddress();
    error RootTotalDecreased();
    error Underfunded(uint256 available, uint256 needed);
    error InvalidProof();
    error NothingToClaim();
    error TransferFailed();
    error RouterCallFailed(bytes reason);
    error RouterLeftUsdg(uint256 left);
    error OutputTooLow(uint256 received, uint256 minOut);
    error WouldTakeClaimable(uint256 free, uint256 asked);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(IERC20 usdg_, address router_, address owner_) {
        if (address(usdg_) == address(0) || router_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        usdg = usdg_;
        router = router_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Owner
    // ----------------------------------------------------------------------------------------------------------------

    /// @notice Posts a new root. `total` is the sum of all cumulative amounts in it, and the contract must already
    /// hold enough USDG to pay all of it (counted as balance plus everything paid out so far). The poster's roots may
    /// only grow the total, within its limits. The owner may post any total, including a lower one: after a wrong
    /// root (say from a stolen poster key) it posts the honest tree, and must then top up whatever the wrong root
    /// let out, because "paid out so far" still counts that money (2026-11-26 re-review, C1 and C2).
    function setRoot(bytes32 newRoot, uint256 total) external {
        if (msg.sender != owner) {
            if (msg.sender != poster || poster == address(0)) revert NotPoster();
            if (paused) revert IsPaused();
            // The interval runs from the last root; before any root there is nothing to wait for.
            uint256 nextAllowedAt = uint256(lastPostedAt) + minInterval;
            if (lastPostedAt != 0 && block.timestamp < nextAllowedAt) revert TooSoon(nextAllowedAt);
            // Checked before the subtraction below can underflow; the general check follows.
            if (total < rootTotal) revert RootTotalDecreased();
            if (total - rootTotal > maxIncrease) revert IncreaseTooLarge(total - rootTotal, maxIncrease);
        }
        uint256 available = usdg.balanceOf(address(this)) + totalClaimed;
        if (available < total) revert Underfunded(available, total);
        root = newRoot;
        rootTotal = total;
        epoch += 1;
        lastPostedAt = uint64(block.timestamp);
        emit RootPosted(epoch, newRoot, total, msg.sender);
    }

    /// @notice Sets (or, with zero, removes) the poster key.
    function setPoster(address newPoster) external onlyOwner {
        poster = newPoster;
        emit PosterSet(newPoster);
    }

    /// @notice Sets the payout budget: at most `newMaxPayout` held, refilled from empty over `newWindow` seconds.
    /// The first time it is set, the budget starts full; later, what is left carries over (capped at the new most).
    function setPayoutLimit(uint256 newMaxPayout, uint64 newWindow) external onlyOwner {
        if (newWindow < 1 hours) revert WindowTooShort();
        // Keeps maxPayout * elapsed (elapsed < 2^64) far from overflow in the refill.
        if (newMaxPayout > type(uint128).max) revert PayoutLimitTooLarge();
        uint256 current = maxPayout == 0 ? newMaxPayout : _refilledBudget();
        maxPayout = newMaxPayout;
        payoutWindow = newWindow;
        budget = current < newMaxPayout ? current : newMaxPayout;
        budgetUpdatedAt = uint64(block.timestamp);
        emit PayoutLimitSet(newMaxPayout, newWindow);
    }

    /// @notice Sets the poster's limits: the most one root may add, and the least time between its roots.
    function setLimits(uint256 newMaxIncrease, uint64 newMinInterval) external onlyOwner {
        maxIncrease = newMaxIncrease;
        minInterval = newMinInterval;
        emit LimitsSet(newMaxIncrease, newMinInterval);
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit Paused(value);
    }

    /// @notice Two-step ownership transfer, so a typo cannot lock the contract.
    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// @notice Moves tokens out. For USDG only the excess above what is still claimable can leave.
    function rescue(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(usdg)) {
            // Guarded: if a corrected root ever gave a wallet less than it already took, totalClaimed can exceed
            // rootTotal; then nothing counts as still owed rather than the subtraction reverting.
            uint256 stillOwed = rootTotal > totalClaimed ? rootTotal - totalClaimed : 0;
            uint256 balance = usdg.balanceOf(address(this));
            uint256 free = balance > stillOwed ? balance - stillOwed : 0;
            if (amount > free) revert WouldTakeClaimable(free, amount);
        }
        _transfer(IERC20(token), to, amount);
        emit Rescued(token, to, amount);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Claim
    // ----------------------------------------------------------------------------------------------------------------

    /// @notice USDG the wallet is owed, given its cumulative amount from the current tree (before the budget).
    function claimable(address wallet, uint256 cumulative) external view returns (uint256) {
        uint256 done = claimed[wallet];
        return cumulative > done ? cumulative - done : 0;
    }

    /// @notice USDG the payout budget allows right now, for all claims together.
    function payoutBudget() external view returns (uint256) {
        return _refilledBudget();
    }

    /// @notice Claims as USDG, straight to the caller.
    function claim(uint256 cumulative, bytes32[] calldata proof) external nonReentrant returns (uint256 amount) {
        amount = _settle(cumulative, proof, type(uint256).max);
        _transfer(usdg, msg.sender, amount);
        emit Claimed(msg.sender, amount, cumulative, address(usdg), amount);
    }

    /// @notice Claims and swaps into a stock token in one transaction. `routerCalldata` is a Universal Router call
    /// built by the app that spends exactly the claimed USDG (already in the router, payer = router) and sends the
    /// stock to the caller. The caller must end up with at least `minOut` more of `outToken`. At most `maxAmount` USDG
    /// is claimed (and swapped): the app sets it to the amount `minOut` was quoted for, so a budget that refilled
    /// after the transaction was built cannot swap more against the same floor (re-review C4).
    function claimAndSwap(uint256 cumulative, bytes32[] calldata proof, bytes calldata routerCalldata, IERC20 outToken, uint256 minOut, uint256 maxAmount)
        external
        nonReentrant
        returns (uint256 amount, uint256 received)
    {
        amount = _settle(cumulative, proof, maxAmount);
        received = _swap(amount, routerCalldata, outToken, minOut);
        emit Claimed(msg.sender, amount, cumulative, address(outToken), received);
    }

    // ----------------------------------------------------------------------------------------------------------------
    // Internals
    // ----------------------------------------------------------------------------------------------------------------

    /// @dev Checks the proof and books the claim before any token moves (checks-effects-interactions).
    function _settle(uint256 cumulative, bytes32[] calldata proof, uint256 maxAmount) private returns (uint256 amount) {
        if (paused) revert IsPaused();
        // Leaf = keccak256(keccak256(abi.encode(wallet, cumulative))), the double hash OpenZeppelin's tree uses,
        // so a leaf can never be read as an inner node.
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, cumulative))));
        if (!_verify(proof, root, leaf)) revert InvalidProof();

        uint256 done = claimed[msg.sender];
        if (cumulative <= done) revert NothingToClaim();

        // Spend from the shared budget; pay what it allows, the rest waits for the refill.
        uint256 available = _refilledBudget();
        if (available == 0) revert PayoutBudgetEmpty();
        uint256 owed = cumulative - done;
        amount = owed < available ? owed : available;
        if (amount > maxAmount) amount = maxAmount;
        if (amount == 0) revert NothingToClaim();
        budget = available - amount;
        budgetUpdatedAt = uint64(block.timestamp);

        claimed[msg.sender] = done + amount;
        totalClaimed += amount;
    }

    /// @dev The budget now: what was left at the last update plus the even refill since, capped at `maxPayout`.
    function _refilledBudget() private view returns (uint256) {
        if (maxPayout == 0) return 0;
        uint256 elapsed = block.timestamp - budgetUpdatedAt;
        if (elapsed >= payoutWindow) return maxPayout;
        uint256 refilled = budget + (maxPayout * elapsed) / payoutWindow;
        return refilled < maxPayout ? refilled : maxPayout;
    }

    /// @dev Sends the claimed USDG to the router, runs the app's swap, and checks the router used all of it and the
    /// caller received at least `minOut` of the stock.
    function _swap(uint256 amount, bytes calldata routerCalldata, IERC20 outToken, uint256 minOut) private returns (uint256 received) {
        uint256 routerUsdgBefore = usdg.balanceOf(router);
        uint256 outBefore = outToken.balanceOf(msg.sender);

        _transfer(usdg, router, amount);
        (bool ok, bytes memory reason) = router.call(routerCalldata);
        if (!ok) revert RouterCallFailed(reason);

        // The router must have spent the whole claim (it may have held dust before; that is not ours to check).
        uint256 routerUsdgAfter = usdg.balanceOf(router);
        if (routerUsdgAfter > routerUsdgBefore) revert RouterLeftUsdg(routerUsdgAfter - routerUsdgBefore);

        received = outToken.balanceOf(msg.sender) - outBefore;
        if (received < minOut) revert OutputTooLow(received, minOut);
    }

    /// @dev Merkle proof check with sorted pairs (same rule as OpenZeppelin's MerkleProof and StandardMerkleTree).
    function _verify(bytes32[] calldata proof, bytes32 expectedRoot, bytes32 leaf) private pure returns (bool) {
        bytes32 hash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sibling = proof[i];
            hash = hash < sibling ? keccak256(abi.encodePacked(hash, sibling)) : keccak256(abi.encodePacked(sibling, hash));
        }
        return hash == expectedRoot;
    }

    /// @dev ERC-20 transfer that accepts tokens returning nothing or true, and fails on false or a revert.
    function _transfer(IERC20 token, address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
