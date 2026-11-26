// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20, VeulClaimsV3} from "../src/VeulClaimsV3.sol";

/// Plain ERC-20 for the unit tests.
contract MockTokenV3 {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// Stand-in for the Universal Router: swap(recipient, usdgIn, out) takes `usdgIn` from its own USDG balance
/// (as the real router does with payer = router) and pays `out` stock tokens to `recipient`.
contract MockRouterV3 {
    MockTokenV3 public immutable usdg;
    MockTokenV3 public immutable stock;

    constructor(MockTokenV3 usdg_, MockTokenV3 stock_) {
        usdg = usdg_;
        stock = stock_;
    }

    function swap(address recipient, uint256 usdgIn, uint256 out) external {
        usdg.transfer(address(0xdead), usdgIn); // "spent" into a pool
        stock.mint(recipient, out);
    }

    function fail() external pure {
        revert("router says no");
    }
}

contract VeulClaimsV3Test is Test {
    MockTokenV3 usdg;
    MockTokenV3 stock;
    MockRouterV3 router;
    VeulClaimsV3 claims;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        usdg = new MockTokenV3();
        stock = new MockTokenV3();
        router = new MockRouterV3(usdg, stock);
        claims = new VeulClaimsV3(IERC20(address(usdg)), address(router), owner);
        // The v2 tests below run with a budget too large to matter; the budget has its own tests.
        vm.prank(owner);
        claims.setPayoutLimit(type(uint128).max, 1 days);
    }

    // ---- Merkle helpers (same rules as the contract and scripts/claims-epoch.mjs) --------------------------------

    function leaf(address wallet, uint256 cumulative) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(wallet, cumulative))));
    }

    function pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// Three-leaf tree: root = pair(pair(A, B), C). Returns the root and each leaf's proof.
    function tree3(bytes32 a, bytes32 b, bytes32 c) internal pure returns (bytes32 root, bytes32[][] memory proofs) {
        bytes32 ab = pair(a, b);
        root = pair(ab, c);
        proofs = new bytes32[][](3);
        proofs[0] = new bytes32[](2);
        proofs[0][0] = b;
        proofs[0][1] = c;
        proofs[1] = new bytes32[](2);
        proofs[1][0] = a;
        proofs[1][1] = c;
        proofs[2] = new bytes32[](1);
        proofs[2][0] = ab;
    }

    function postWeek(uint256 a, uint256 b, uint256 c) internal returns (bytes32[][] memory proofs) {
        bytes32 root;
        (root, proofs) = tree3(leaf(alice, a), leaf(bob, b), leaf(carol, c));
        vm.prank(owner);
        claims.setRoot(root, a + b + c);
    }

    // ---- setRoot ------------------------------------------------------------------------------------------------

    function test_setRoot_needsFunding() public {
        (bytes32 root,) = tree3(leaf(alice, 100), leaf(bob, 50), leaf(carol, 10));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(VeulClaimsV3.Underfunded.selector, 0, 160));
        claims.setRoot(root, 160);

        usdg.mint(address(claims), 160);
        vm.prank(owner);
        claims.setRoot(root, 160);
        assertEq(claims.root(), root);
        assertEq(claims.epoch(), 1);
    }

    function test_setRoot_onlyOwnerOrPoster() public {
        vm.expectRevert(VeulClaimsV3.NotPoster.selector);
        claims.setRoot(bytes32(uint256(1)), 0);
    }

    /// v3: the owner may lower the total (corrections after a wrong root); the poster may not.
    function test_setRoot_onlyOwnerMayShrink() public {
        usdg.mint(address(claims), 160);
        postWeek(100, 50, 10);
        vm.prank(owner);
        claims.setRoot(bytes32(uint256(1)), 159);
        assertEq(claims.rootTotal(), 159);
        vm.prank(owner);
        claims.setPoster(poster);
        vm.prank(poster);
        vm.expectRevert(VeulClaimsV3.RootTotalDecreased.selector);
        claims.setRoot(bytes32(uint256(2)), 158);
    }

    /// v3 (re-review C4): claimAndSwap pays at most maxAmount, whatever the budget allows by then.
    function test_claimAndSwap_capsAtMaxAmount() public {
        usdg.mint(address(claims), 160);
        bytes32[][] memory proofs = postWeek(100, 50, 10);
        bytes memory call = abi.encodeCall(MockRouterV3.swap, (alice, 40, 4));
        vm.prank(alice);
        (uint256 amount,) = claims.claimAndSwap(100, proofs[0], call, IERC20(address(stock)), 4, 40);
        assertEq(amount, 40);
        assertEq(claims.claimed(alice), 40);
        vm.prank(alice);
        vm.expectRevert(VeulClaimsV3.NothingToClaim.selector);
        claims.claimAndSwap(100, proofs[0], call, IERC20(address(stock)), 0, 0);
    }

    // ---- claim (USDG) -------------------------------------------------------------------------------------------

    function test_claim_paysAndBooks() public {
        usdg.mint(address(claims), 160);
        bytes32[][] memory proofs = postWeek(100, 50, 10);

        vm.prank(alice);
        assertEq(claims.claim(100, proofs[0]), 100);
        assertEq(usdg.balanceOf(alice), 100);
        assertEq(claims.claimed(alice), 100);
        assertEq(claims.totalClaimed(), 100);

        // Same proof again: nothing left.
        vm.prank(alice);
        vm.expectRevert(VeulClaimsV3.NothingToClaim.selector);
        claims.claim(100, proofs[0]);
    }

    function test_claim_rejectsWrongAmountOrWallet() public {
        usdg.mint(address(claims), 160);
        bytes32[][] memory proofs = postWeek(100, 50, 10);

        vm.prank(alice);
        vm.expectRevert(VeulClaimsV3.InvalidProof.selector);
        claims.claim(101, proofs[0]);

        // Bob cannot use Alice's leaf.
        vm.prank(bob);
        vm.expectRevert(VeulClaimsV3.InvalidProof.selector);
        claims.claim(100, proofs[0]);
    }

    function test_claim_cumulativeOverWeeks() public {
        usdg.mint(address(claims), 160);
        bytes32[][] memory week1 = postWeek(100, 50, 10);
        vm.prank(alice);
        claims.claim(100, week1[0]);

        // Week 2: Alice earned 40 more (cumulative 140); Bob never claimed (cumulative 80).
        usdg.mint(address(claims), 70);
        bytes32[][] memory week2 = postWeek(140, 80, 10);

        vm.prank(alice);
        assertEq(claims.claim(140, week2[0]), 40);
        vm.prank(bob);
        assertEq(claims.claim(80, week2[1]), 80);
        assertEq(usdg.balanceOf(alice), 140);
        assertEq(usdg.balanceOf(bob), 80);
    }

    function test_claim_paused() public {
        usdg.mint(address(claims), 160);
        bytes32[][] memory proofs = postWeek(100, 50, 10);
        vm.prank(owner);
        claims.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(VeulClaimsV3.IsPaused.selector);
        claims.claim(100, proofs[0]);
    }

    // ---- claimAndSwap -------------------------------------------------------------------------------------------

    function test_claimAndSwap_deliversStock() public {
        usdg.mint(address(claims), 160);
        bytes32[][] memory proofs = postWeek(100, 50, 10);
        bytes memory call = abi.encodeCall(MockRouterV3.swap, (alice, 100, 7));

        vm.prank(alice);
        (uint256 amount, uint256 received) = claims.claimAndSwap(100, proofs[0], call, IERC20(address(stock)), 7, type(uint256).max);
        assertEq(amount, 100);
        assertEq(received, 7);
        assertEq(stock.balanceOf(alice), 7);
        assertEq(usdg.balanceOf(address(router)), 0);
    }

    function test_claimAndSwap_minOut() public {
        usdg.mint(address(claims), 160);
        bytes32[][] memory proofs = postWeek(100, 50, 10);
        bytes memory call = abi.encodeCall(MockRouterV3.swap, (alice, 100, 6));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VeulClaimsV3.OutputTooLow.selector, 6, 7));
        claims.claimAndSwap(100, proofs[0], call, IERC20(address(stock)), 7, type(uint256).max);
    }

    function test_claimAndSwap_routerMustSpendAll() public {
        usdg.mint(address(claims), 160);
        bytes32[][] memory proofs = postWeek(100, 50, 10);
        bytes memory call = abi.encodeCall(MockRouterV3.swap, (alice, 60, 7)); // leaves 40 USDG in the router
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VeulClaimsV3.RouterLeftUsdg.selector, 40));
        claims.claimAndSwap(100, proofs[0], call, IERC20(address(stock)), 7, type(uint256).max);
    }

    function test_claimAndSwap_routerFailureRevertsEverything() public {
        usdg.mint(address(claims), 160);
        bytes32[][] memory proofs = postWeek(100, 50, 10);
        vm.prank(alice);
        vm.expectRevert();
        claims.claimAndSwap(100, proofs[0], abi.encodeCall(MockRouterV3.fail, ()), IERC20(address(stock)), 1, type(uint256).max);
        assertEq(claims.claimed(alice), 0);
        assertEq(usdg.balanceOf(address(claims)), 160);
    }

    // ---- rescue and ownership -----------------------------------------------------------------------------------

    function test_rescue_onlyExcess() public {
        usdg.mint(address(claims), 200); // 40 more than owed
        bytes32[][] memory proofs = postWeek(100, 50, 10);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(VeulClaimsV3.WouldTakeClaimable.selector, 40, 41));
        claims.rescue(address(usdg), owner, 41);

        vm.prank(owner);
        claims.rescue(address(usdg), owner, 40);

        // Everyone can still be paid in full.
        vm.prank(alice);
        claims.claim(100, proofs[0]);
        vm.prank(bob);
        claims.claim(50, proofs[1]);
        vm.prank(carol);
        claims.claim(10, proofs[2]);
        assertEq(usdg.balanceOf(address(claims)), 0);
    }

    function test_ownership_twoStep() public {
        vm.prank(owner);
        claims.transferOwnership(bob);
        assertEq(claims.owner(), owner);
        vm.prank(carol);
        vm.expectRevert(VeulClaimsV3.NotOwner.selector);
        claims.acceptOwnership();
        vm.prank(bob);
        claims.acceptOwnership();
        assertEq(claims.owner(), bob);
    }

    // ---- Fuzz: nobody can take more than their cumulative amount ------------------------------------------------

    function testFuzz_neverOverpays(uint64 a, uint64 b, uint64 c, uint64 extra) public {
        uint256 total = uint256(a) + b + c;
        usdg.mint(address(claims), total + extra);
        bytes32[][] memory proofs = postWeek(a, b, c);
        if (a > 0) {
            vm.prank(alice);
            claims.claim(a, proofs[0]);
        }
        if (b > 0) {
            vm.prank(bob);
            claims.claim(b, proofs[1]);
        }
        if (c > 0) {
            vm.prank(carol);
            claims.claim(c, proofs[2]);
        }
        assertEq(usdg.balanceOf(alice) + usdg.balanceOf(bob) + usdg.balanceOf(carol), total);
        assertEq(usdg.balanceOf(address(claims)), extra);
    }

    // ---- v2: the poster ------------------------------------------------------------------------------------------

    address poster = makeAddr("poster");

    function setUpPoster(uint256 maxIncrease, uint64 minInterval) internal {
        vm.startPrank(owner);
        claims.setPoster(poster);
        claims.setLimits(maxIncrease, minInterval);
        vm.stopPrank();
    }

    function posterPosts(uint256 a, uint256 b, uint256 c) internal returns (bytes32[][] memory proofs) {
        bytes32 root;
        (root, proofs) = tree3(leaf(alice, a), leaf(bob, b), leaf(carol, c));
        vm.prank(poster);
        claims.setRoot(root, a + b + c);
    }

    function test_poster_postsWithinLimits() public {
        usdg.mint(address(claims), 1_000);
        setUpPoster(200, 1 days);
        bytes32[][] memory proofs = posterPosts(100, 50, 10);
        assertEq(claims.epoch(), 1);
        assertEq(claims.lastPostedAt(), block.timestamp);
        vm.prank(alice);
        claims.claim(100, proofs[0]);
        assertEq(usdg.balanceOf(alice), 100);
    }

    function test_poster_onlyOwnerSetsPosterAndLimits() public {
        vm.prank(poster);
        vm.expectRevert(VeulClaimsV3.NotOwner.selector);
        claims.setPoster(poster);
        vm.prank(poster);
        vm.expectRevert(VeulClaimsV3.NotOwner.selector);
        claims.setLimits(type(uint256).max, 0);
    }

    function test_poster_noPosterSetMeansNobody() public {
        // Before setPoster, the zero address is the poster; nobody may act as it.
        vm.prank(address(0));
        vm.expectRevert(VeulClaimsV3.NotPoster.selector);
        claims.setRoot(bytes32(uint256(1)), 0);
    }

    function test_poster_capPerRoot() public {
        usdg.mint(address(claims), 1_000);
        setUpPoster(100, 0);
        (bytes32 root,) = tree3(leaf(alice, 100), leaf(bob, 50), leaf(carol, 10));
        vm.prank(poster);
        vm.expectRevert(abi.encodeWithSelector(VeulClaimsV3.IncreaseTooLarge.selector, 160, 100));
        claims.setRoot(root, 160);
        // Exactly the cap is fine.
        posterPosts(60, 30, 10);
        assertEq(claims.rootTotal(), 100);
    }

    function test_poster_minInterval() public {
        usdg.mint(address(claims), 1_000);
        setUpPoster(1_000, 20 hours);
        posterPosts(10, 10, 10);
        (bytes32 root,) = tree3(leaf(alice, 20), leaf(bob, 10), leaf(carol, 10));
        vm.warp(block.timestamp + 20 hours - 1);
        vm.prank(poster);
        vm.expectRevert(abi.encodeWithSelector(VeulClaimsV3.TooSoon.selector, block.timestamp + 1));
        claims.setRoot(root, 40);
        vm.warp(block.timestamp + 1);
        vm.prank(poster);
        claims.setRoot(root, 40);
        assertEq(claims.epoch(), 2);
    }

    function test_poster_ownerRootResetsTheClock() public {
        usdg.mint(address(claims), 1_000);
        setUpPoster(1_000, 1 days);
        vm.warp(10 days);
        postWeek(10, 10, 10); // owner
        (bytes32 root,) = tree3(leaf(alice, 20), leaf(bob, 10), leaf(carol, 10));
        vm.prank(poster);
        vm.expectRevert(abi.encodeWithSelector(VeulClaimsV3.TooSoon.selector, block.timestamp + 1 days));
        claims.setRoot(root, 40);
    }

    function test_poster_blockedWhilePaused() public {
        usdg.mint(address(claims), 1_000);
        setUpPoster(1_000, 0);
        vm.prank(owner);
        claims.setPaused(true);
        (bytes32 root,) = tree3(leaf(alice, 10), leaf(bob, 10), leaf(carol, 10));
        vm.prank(poster);
        vm.expectRevert(VeulClaimsV3.IsPaused.selector);
        claims.setRoot(root, 30);
        // The owner can still post a correction while paused.
        vm.prank(owner);
        claims.setRoot(root, 30);
    }

    function test_poster_stillBoundByFundingAndGrowth() public {
        usdg.mint(address(claims), 50);
        setUpPoster(1_000, 0);
        (bytes32 root,) = tree3(leaf(alice, 100), leaf(bob, 50), leaf(carol, 10));
        vm.prank(poster);
        vm.expectRevert(abi.encodeWithSelector(VeulClaimsV3.Underfunded.selector, 50, 160));
        claims.setRoot(root, 160);
        posterPosts(20, 20, 10);
        (root,) = tree3(leaf(alice, 10), leaf(bob, 10), leaf(carol, 10));
        vm.prank(poster);
        vm.expectRevert(VeulClaimsV3.RootTotalDecreased.selector);
        claims.setRoot(root, 30);
    }

    function test_poster_canBeRemoved() public {
        setUpPoster(1_000, 0);
        vm.prank(owner);
        claims.setPoster(address(0));
        vm.prank(poster);
        vm.expectRevert(VeulClaimsV3.NotPoster.selector);
        claims.setRoot(bytes32(uint256(1)), 0);
    }

    function test_poster_cannotRescueOrPause() public {
        setUpPoster(1_000, 0);
        vm.startPrank(poster);
        vm.expectRevert(VeulClaimsV3.NotOwner.selector);
        claims.rescue(address(usdg), poster, 1);
        vm.expectRevert(VeulClaimsV3.NotOwner.selector);
        claims.setPaused(false);
        vm.expectRevert(VeulClaimsV3.NotOwner.selector);
        claims.transferOwnership(poster);
        vm.stopPrank();
    }


    // ---- v3: the payout budget --------------------------------------------------------------------------------------

    function freshWithBudget(uint256 maxPayout, uint64 window) internal returns (VeulClaimsV3 c) {
        c = new VeulClaimsV3(IERC20(address(usdg)), address(router), owner);
        vm.startPrank(owner);
        c.setPoster(poster);
        c.setLimits(50e6, 20 hours);
        if (maxPayout > 0) c.setPayoutLimit(maxPayout, window);
        vm.stopPrank();
    }

    function postAs(VeulClaimsV3 c, address who, address wallet, uint256 cumulative, uint256 total) internal {
        vm.prank(who);
        c.setRoot(leaf(wallet, cumulative), total);
    }

    function test_budget_noClaimsBeforeItIsSet() public {
        VeulClaimsV3 c = freshWithBudget(0, 0);
        usdg.mint(address(c), 100);
        postAs(c, owner, alice, 100, 100);
        vm.prank(alice);
        vm.expectRevert(VeulClaimsV3.PayoutBudgetEmpty.selector);
        c.claim(100, new bytes32[](0));
    }

    function test_budget_onlyOwnerAndSaneValues() public {
        vm.prank(poster);
        vm.expectRevert(VeulClaimsV3.NotOwner.selector);
        claims.setPayoutLimit(1, 1 days);
        vm.startPrank(owner);
        vm.expectRevert(VeulClaimsV3.WindowTooShort.selector);
        claims.setPayoutLimit(1, 59 minutes);
        vm.expectRevert(VeulClaimsV3.PayoutLimitTooLarge.selector);
        claims.setPayoutLimit(uint256(type(uint128).max) + 1, 1 days);
        vm.stopPrank();
    }

    /// The review's attack on v2, replayed on v3: a stolen poster key gets at most the budget, not the balance.
    function test_budget_stolenPosterGetsAtMostTheBudget() public {
        VeulClaimsV3 c = freshWithBudget(25e6, 1 days);
        usdg.mint(address(c), 1_000e6);
        postAs(c, owner, alice, 300e6, 300e6);
        vm.warp(block.timestamp + 20 hours);
        address thief = makeAddr("thief");
        postAs(c, poster, thief, 1_000e6, 300e6);
        vm.prank(thief);
        c.claim(1_000e6, new bytes32[](0));
        assertEq(usdg.balanceOf(thief), 25e6, "only the budget");
        vm.prank(thief);
        vm.expectRevert(VeulClaimsV3.PayoutBudgetEmpty.selector);
        c.claim(1_000e6, new bytes32[](0));
        // The owner pauses; nothing more leaves, whatever the time.
        vm.prank(owner);
        c.setPaused(true);
        vm.warp(block.timestamp + 30 days);
        vm.prank(thief);
        vm.expectRevert(VeulClaimsV3.IsPaused.selector);
        c.claim(1_000e6, new bytes32[](0));
        assertEq(usdg.balanceOf(address(c)), 975e6);
    }

    function test_budget_partialClaimThenTheRest() public {
        VeulClaimsV3 c = freshWithBudget(60, 1 days);
        usdg.mint(address(c), 100);
        postAs(c, owner, alice, 100, 100);
        vm.prank(alice);
        uint256 paid = c.claim(100, new bytes32[](0));
        assertEq(paid, 60);
        assertEq(c.claimed(alice), 60);
        assertEq(c.payoutBudget(), 0);
        // Half a window refills half the budget.
        vm.warp(block.timestamp + 12 hours);
        assertEq(c.payoutBudget(), 30);
        vm.prank(alice);
        assertEq(c.claim(100, new bytes32[](0)), 30);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        assertEq(c.claim(100, new bytes32[](0)), 10);
        assertEq(usdg.balanceOf(alice), 100);
        vm.prank(alice);
        vm.expectRevert(VeulClaimsV3.NothingToClaim.selector);
        c.claim(100, new bytes32[](0));
    }

    function test_budget_refillIsCapped() public {
        VeulClaimsV3 c = freshWithBudget(50, 1 days);
        vm.warp(block.timestamp + 365 days);
        assertEq(c.payoutBudget(), 50);
    }

    function test_budget_newLimitCarriesOverWhatIsLeft() public {
        VeulClaimsV3 c = freshWithBudget(100, 1 days);
        usdg.mint(address(c), 100);
        postAs(c, owner, alice, 80, 80);
        vm.prank(alice);
        c.claim(80, new bytes32[](0));
        assertEq(c.payoutBudget(), 20);
        vm.prank(owner);
        c.setPayoutLimit(200, 1 days); // raising the limit does not refill at once
        assertEq(c.payoutBudget(), 20);
        vm.prank(owner);
        c.setPayoutLimit(10, 1 days); // lowering caps what is left
        assertEq(c.payoutBudget(), 10);
    }

    function test_budget_claimAndSwapPaysInPart() public {
        VeulClaimsV3 c = freshWithBudget(60, 1 days);
        usdg.mint(address(c), 100);
        postAs(c, owner, alice, 100, 100);
        bytes memory call = abi.encodeCall(MockRouterV3.swap, (alice, 60, 6));
        vm.prank(alice);
        (uint256 amount, uint256 received) = c.claimAndSwap(100, new bytes32[](0), call, IERC20(address(stock)), 6, type(uint256).max);
        assertEq(amount, 60);
        assertEq(received, 6);
    }

    /// Review finding 2: an owner correction that lowers a wallet below what it took must not brick rescue.
    function test_rescue_afterAWalletWasLowered() public {
        VeulClaimsV3 c = freshWithBudget(type(uint128).max, 1 days);
        usdg.mint(address(c), 100);
        postAs(c, owner, alice, 100, 100);
        vm.prank(alice);
        c.claim(100, new bytes32[](0));
        // Correction: alice 0 (she took 100), total stays 100 (it may not shrink); bob nothing yet.
        postAs(c, owner, bob, 0, 100);
        usdg.mint(address(c), 5);
        vm.prank(owner);
        c.rescue(address(usdg), owner, 5); // must not revert on rootTotal - totalClaimed
        assertEq(usdg.balanceOf(owner), 5);
    }

    /// Whatever roots a thief posts and whenever they claim, payouts over a span t stay within
    /// maxPayout + maxPayout * t / window.
    function testFuzz_budget_boundsEveryPayout(uint96 maxPayout, uint32 window, uint8 tries, uint32 span) public {
        maxPayout = uint96(bound(maxPayout, 1, 1e15));
        window = uint32(bound(window, 1 hours, 30 days));
        tries = uint8(bound(tries, 1, 40));
        span = uint32(bound(span, 0, 90 days));
        VeulClaimsV3 c = freshWithBudget(maxPayout, window);
        usdg.mint(address(c), uint256(maxPayout) * 200);
        address thief = makeAddr("thief");
        // The owner's own first root, then the thief's root giving itself everything.
        postAs(c, owner, alice, 1, 1);
        vm.warp(block.timestamp + 21 hours);
        postAs(c, poster, thief, uint256(maxPayout) * 200, 1);
        uint256 start = block.timestamp;
        for (uint256 i = 0; i < tries; i++) {
            vm.warp(start + (uint256(span) * (i + 1)) / tries);
            vm.prank(thief);
            try c.claim(uint256(maxPayout) * 200, new bytes32[](0)) {} catch {}
        }
        uint256 bound_ = uint256(maxPayout) + (uint256(maxPayout) * span) / window;
        assertLe(usdg.balanceOf(thief), bound_);
    }
}
