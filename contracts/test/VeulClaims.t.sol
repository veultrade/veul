// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20, VeulClaims} from "../src/VeulClaims.sol";

/// Plain ERC-20 for the unit tests.
contract MockToken {
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
contract MockRouter {
    MockToken public immutable usdg;
    MockToken public immutable stock;

    constructor(MockToken usdg_, MockToken stock_) {
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

contract VeulClaimsTest is Test {
    MockToken usdg;
    MockToken stock;
    MockRouter router;
    VeulClaims claims;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        usdg = new MockToken();
        stock = new MockToken();
        router = new MockRouter(usdg, stock);
        claims = new VeulClaims(IERC20(address(usdg)), address(router), owner);
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
        vm.expectRevert(abi.encodeWithSelector(VeulClaims.Underfunded.selector, 0, 160));
        claims.setRoot(root, 160);

        usdg.mint(address(claims), 160);
        vm.prank(owner);
        claims.setRoot(root, 160);
        assertEq(claims.root(), root);
        assertEq(claims.epoch(), 1);
    }

    function test_setRoot_onlyOwner() public {
        vm.expectRevert(VeulClaims.NotOwner.selector);
        claims.setRoot(bytes32(uint256(1)), 0);
    }

    function test_setRoot_totalCannotShrink() public {
        usdg.mint(address(claims), 160);
        postWeek(100, 50, 10);
        vm.prank(owner);
        vm.expectRevert(VeulClaims.RootTotalDecreased.selector);
        claims.setRoot(bytes32(uint256(1)), 159);
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
        vm.expectRevert(VeulClaims.NothingToClaim.selector);
        claims.claim(100, proofs[0]);
    }

    function test_claim_rejectsWrongAmountOrWallet() public {
        usdg.mint(address(claims), 160);
        bytes32[][] memory proofs = postWeek(100, 50, 10);

        vm.prank(alice);
        vm.expectRevert(VeulClaims.InvalidProof.selector);
        claims.claim(101, proofs[0]);

        // Bob cannot use Alice's leaf.
        vm.prank(bob);
        vm.expectRevert(VeulClaims.InvalidProof.selector);
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
        vm.expectRevert(VeulClaims.IsPaused.selector);
        claims.claim(100, proofs[0]);
    }

    // ---- claimAndSwap -------------------------------------------------------------------------------------------

    function test_claimAndSwap_deliversStock() public {
        usdg.mint(address(claims), 160);
        bytes32[][] memory proofs = postWeek(100, 50, 10);
        bytes memory call = abi.encodeCall(MockRouter.swap, (alice, 100, 7));

        vm.prank(alice);
        (uint256 amount, uint256 received) = claims.claimAndSwap(100, proofs[0], call, IERC20(address(stock)), 7);
        assertEq(amount, 100);
        assertEq(received, 7);
        assertEq(stock.balanceOf(alice), 7);
        assertEq(usdg.balanceOf(address(router)), 0);
    }

    function test_claimAndSwap_minOut() public {
        usdg.mint(address(claims), 160);
        bytes32[][] memory proofs = postWeek(100, 50, 10);
        bytes memory call = abi.encodeCall(MockRouter.swap, (alice, 100, 6));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VeulClaims.OutputTooLow.selector, 6, 7));
        claims.claimAndSwap(100, proofs[0], call, IERC20(address(stock)), 7);
    }

    function test_claimAndSwap_routerMustSpendAll() public {
        usdg.mint(address(claims), 160);
        bytes32[][] memory proofs = postWeek(100, 50, 10);
        bytes memory call = abi.encodeCall(MockRouter.swap, (alice, 60, 7)); // leaves 40 USDG in the router
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VeulClaims.RouterLeftUsdg.selector, 40));
        claims.claimAndSwap(100, proofs[0], call, IERC20(address(stock)), 7);
    }

    function test_claimAndSwap_routerFailureRevertsEverything() public {
        usdg.mint(address(claims), 160);
        bytes32[][] memory proofs = postWeek(100, 50, 10);
        vm.prank(alice);
        vm.expectRevert();
        claims.claimAndSwap(100, proofs[0], abi.encodeCall(MockRouter.fail, ()), IERC20(address(stock)), 1);
        assertEq(claims.claimed(alice), 0);
        assertEq(usdg.balanceOf(address(claims)), 160);
    }

    // ---- rescue and ownership -----------------------------------------------------------------------------------

    function test_rescue_onlyExcess() public {
        usdg.mint(address(claims), 200); // 40 more than owed
        bytes32[][] memory proofs = postWeek(100, 50, 10);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(VeulClaims.WouldTakeClaimable.selector, 40, 41));
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
        vm.expectRevert(VeulClaims.NotOwner.selector);
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
}
