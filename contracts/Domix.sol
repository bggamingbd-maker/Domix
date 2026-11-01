// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// DOMIX: one contract for fixed-price listings, offers, English auctions and owner-written identity
// records for ArcNS names. Sellers keep listed NFTs until purchase; auctions escrow the NFT and bids;
// offers never lock funds; there is no admin withdrawal. Expects standard 6-decimal USDC and ERC-721
// registrars. Pause blocks only new listings, purchases, offers and auctions. Compile with
// solc 0.8.28, EVM cancun, optimizer 200 runs.

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}
interface IERC721 {
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}
interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}

abstract contract Ownable {
    address private _owner;
    error OwnableUnauthorizedAccount(address account);
    error OwnableInvalidOwner(address owner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert OwnableInvalidOwner(address(0));
        _transferOwnership(initialOwner);
    }
    modifier onlyOwner() { if (_owner != msg.sender) revert OwnableUnauthorizedAccount(msg.sender); _; }
    function owner() public view virtual returns (address) { return _owner; }
    function renounceOwnership() public virtual onlyOwner { _transferOwnership(address(0)); }
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) revert OwnableInvalidOwner(address(0));
        _transferOwnership(newOwner);
    }
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner; _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

abstract contract Ownable2Step is Ownable {
    address private _pendingOwner;
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    function pendingOwner() public view virtual returns (address) { return _pendingOwner; }
    function transferOwnership(address newOwner) public virtual override onlyOwner {
        _pendingOwner = newOwner; emit OwnershipTransferStarted(owner(), newOwner);
    }
    function _transferOwnership(address newOwner) internal virtual override {
        delete _pendingOwner; super._transferOwnership(newOwner);
    }
    function acceptOwnership() public virtual {
        if (_pendingOwner != msg.sender) revert OwnableUnauthorizedAccount(msg.sender);
        _transferOwnership(msg.sender);
    }
}

abstract contract Pausable {
    bool private _paused;
    event Paused(address account);
    event Unpaused(address account);
    error EnforcedPause();
    error ExpectedPause();
    modifier whenNotPaused() { if (_paused) revert EnforcedPause(); _; }
    function paused() public view virtual returns (bool) { return _paused; }
    function _pause() internal virtual {
        if (_paused) revert EnforcedPause();
        _paused = true; emit Paused(msg.sender);
    }
    function _unpause() internal virtual {
        if (!_paused) revert ExpectedPause();
        _paused = false; emit Unpaused(msg.sender);
    }
}

abstract contract ReentrancyGuard {
    bytes32 private constant GUARD_SLOT = 0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;
    error ReentrancyGuardReentrantCall();
    constructor() { _setGuard(1); }
    modifier nonReentrant() { _enter(); _; _setGuard(1); }
    function _enter() private {
        bytes32 slot = GUARD_SLOT; uint256 value;
        assembly ("memory-safe") { value := sload(slot) }
        if (value == 2) revert ReentrancyGuardReentrantCall();
        _setGuard(2);
    }
    function _setGuard(uint256 value) private {
        bytes32 slot = GUARD_SLOT;
        assembly ("memory-safe") { sstore(slot, value) }
    }
}

library SafeERC20 {
    error SafeERC20FailedOperation(address token);
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        _call(token, abi.encodeCall(IERC20.transfer, (to, value)));
    }
    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        _call(token, abi.encodeCall(IERC20.transferFrom, (from, to, value)));
    }
    // Bubbles revert data; empty return data is accepted only from a contract, otherwise it must be `true`.
    function _call(IERC20 token, bytes memory data) private {
        (bool ok, bytes memory ret) = address(token).call(data);
        if (!ok) { assembly ("memory-safe") { revert(add(ret, 32), mload(ret)) } }
        if (ret.length == 0 ? address(token).code.length == 0 : ret.length < 32 || abi.decode(ret, (uint256)) != 1) {
            revert SafeERC20FailedOperation(address(token));
        }
    }
}

contract Domix is Ownable2Step, Pausable, ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;
    uint256 public constant MIN_PRICE = 10_000; uint256 public constant MAX_FEE_BPS = 1_000;
    uint256 public constant BPS = 10_000; uint256 public constant MAX_KEY_BYTES = 64;
    uint256 public constant MAX_VALUE_BYTES = 512; uint256 public constant MAX_BATCH = 16;
    // Recommended record keys.
    string public constant KEY_ADDRESS = "address"; string public constant KEY_DISPLAY = "display";
    string public constant KEY_DESCRIPTION = "description"; string public constant KEY_URL = "url";
    string public constant KEY_AVATAR = "avatar"; string public constant KEY_TWITTER = "twitter";
    string public constant KEY_GITHUB = "github"; string public constant KEY_TELEGRAM = "telegram";
    string public constant KEY_DISCORD = "discord";
    struct Listing { address seller; uint128 price; uint64 expiresAt; }
    struct Collection { bool allowed; bool hasExpiry; }
    enum OfferStatus { Active, Accepted, Rejected, Cancelled } enum AuctionStatus { Active, Settled, Cancelled, Failed }
    struct Offer { address offerer; address collection; uint128 price; uint64 expiresAt; uint8 status; uint256 tokenId; }
    struct Auction {
        address seller; address collection; uint256 tokenId; uint128 startPrice; uint128 minIncrement; uint128 highestBid;
        address highestBidder; uint64 endTime; uint64 hardEnd; uint16 feeBps; uint8 status; bool hasExpiry;
    }
    struct Record { string value; address setBy; }
    IERC20 public immutable usdc;
    address public treasury;
    uint16 public feeBps; uint64 public minExpiryBuffer = 7 days;
    mapping(address => Collection) public collectionInfo;
    mapping(address => mapping(uint256 => Listing)) private _listings;
    uint256 public salesCount; uint256 public totalVolume; uint256 public totalFees;
    uint256 public nextOfferId = 1;
    mapping(uint256 => Offer) private _offers;
    uint256 public nextAuctionId = 1;
    mapping(uint256 => Auction) private _auctions;
    mapping(address => uint256) public pendingReturns;
    mapping(uint256 => bool) private _undeliveredClaimed;
    bool private _receiving; uint256 private _receivingId;
    mapping(address => mapping(uint256 => mapping(string => Record))) private _records;
    error ZeroAddress(); error NotContract(); error InvalidPrice(uint256 supplied, uint256 minimum, uint256 maximum);
    error InvalidDuration(); error CollectionNotAllowed(); error InvalidExpiry(); error NameExpired(uint256 expiry);
    error NotTokenOwner(); error InvalidFee(); error InvalidId(); error InvalidStatus(); error Expired();
    error SelfTrade(); error OwnershipRenunciationDisabled(); error MissingListing(); error NotSeller();
    error NotApproved(); error PriceAboveMaximum(uint256 price, uint256 maximum); error InvalidBuffer(); error MarketplacePaused();
    error InsufficientFunds(address account, uint256 required, uint256 balance, uint256 allowance);
    error NotOfferer(); error BidTooLow(uint256 submitted, uint256 required); error NotEnded(); error HasBids();
    error UnexpectedNFT(); error NothingToWithdraw(); error InvalidKey(); error InvalidValue(); error InvalidBatch();
    event CollectionSet(address indexed collection, bool allowed, bool hasExpiry);
    event FeeSet(uint16 feeBps); event TreasurySet(address indexed treasury); event MinExpiryBufferSet(uint64 buffer);
    event Listed(address indexed collection, uint256 indexed tokenId, address indexed seller, uint256 price, uint64 expiresAt);
    event ListingUpdated(address indexed collection, uint256 indexed tokenId, address indexed seller, uint256 price, uint64 expiresAt);
    event ListingCancelled(address indexed collection, uint256 indexed tokenId, address indexed seller);
    event Sold(address indexed collection, uint256 indexed tokenId, address seller, address indexed buyer, uint256 price, uint256 fee);
    event OfferMade(uint256 indexed id, address indexed offerer, address indexed collection, uint256 tokenId, uint256 price, uint64 expiresAt);
    event OfferCancelled(uint256 indexed id, address indexed offerer); event OfferRejected(uint256 indexed id, address indexed seller);
    event OfferAccepted(uint256 indexed id, address indexed seller, address indexed offerer, uint256 price, uint256 fee);
    event AuctionCreated(uint256 indexed id, address indexed collection, uint256 indexed tokenId, address seller, uint256 startPrice, uint256 minIncrement, uint64 endTime, uint64 hardEnd, uint16 feeBps);
    event BidPlaced(uint256 indexed id, address indexed bidder, uint256 amount); event AuctionExtended(uint256 indexed id, uint64 endTime);
    event PaymentSent(address indexed recipient, uint256 amount); event RefundCredited(address indexed recipient, uint256 amount);
    event RefundWithdrawn(address indexed recipient, uint256 amount);
    event AuctionSettled(uint256 indexed id, address indexed seller, address indexed winner, uint256 price, uint256 fee);
    event AuctionCancelled(uint256 indexed id, address indexed seller); event UndeliveredClaimed(uint256 indexed id, address indexed seller);
    event AuctionFailed(uint256 indexed id, address indexed winner, uint256 bid);
    event RecordSet(address indexed collection, uint256 indexed tokenId, bytes32 indexed keyHash, string key, string value, address setBy);
    constructor(IERC20 usdc_, address treasury_, uint16 feeBps_, address owner_) Ownable(owner_) {
        _requireContract(address(usdc_));
        if (treasury_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFee();
        usdc = usdc_;
        treasury = treasury_;
        feeBps = feeBps_;
        emit TreasurySet(treasury_);
        emit FeeSet(feeBps_);
        emit MinExpiryBufferSet(minExpiryBuffer);
    }
    function setCollection(address collection, bool allowed, bool hasExpiry) external onlyOwner {
        _requireContract(collection);
        collectionInfo[collection] = Collection(allowed, hasExpiry);
        emit CollectionSet(collection, allowed, hasExpiry);
    }
    function setFee(uint16 newFee) external onlyOwner {
        if (newFee > MAX_FEE_BPS) revert InvalidFee();
        feeBps = newFee;
        emit FeeSet(newFee);
    }
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasurySet(newTreasury);
    }
    function setMinExpiryBuffer(uint64 buffer) external onlyOwner {
        if (buffer > 90 days) revert InvalidBuffer();
        minExpiryBuffer = buffer;
        emit MinExpiryBufferSet(buffer);
    }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        super.transferOwnership(newOwner);
    }
    function renounceOwnership() public pure override { revert OwnershipRenunciationDisabled(); }
    function list(address collection, uint256 tokenId, uint256 price, uint256 duration) external whenNotPaused {
        uint64 expiry = _validateListing(collection, tokenId, price, duration);
        _clearListing(collection, tokenId);
        _listings[collection][tokenId] = Listing(msg.sender, uint128(price), expiry);
        emit Listed(collection, tokenId, msg.sender, price, expiry);
    }
    function updateListing(address collection, uint256 tokenId, uint256 newPrice, uint256 newDuration) external whenNotPaused {
        if (_listings[collection][tokenId].seller != msg.sender) revert NotSeller();
        uint64 expiry = _validateListing(collection, tokenId, newPrice, newDuration);
        _listings[collection][tokenId] = Listing(msg.sender, uint128(newPrice), expiry);
        emit ListingUpdated(collection, tokenId, msg.sender, newPrice, expiry);
    }
    function cancelListing(address collection, uint256 tokenId) external {
        Listing memory entry = _listings[collection][tokenId];
        if (entry.seller == address(0)) revert MissingListing();
        if (msg.sender != entry.seller && block.timestamp < entry.expiresAt
            && _currentOwner(collection, tokenId) == entry.seller) revert NotSeller();
        _clearListing(collection, tokenId);
    }
    function buy(address collection, uint256 tokenId, uint256 maxPrice) external nonReentrant whenNotPaused {
        Listing memory entry = _listings[collection][tokenId];
        if (entry.seller == address(0)) revert MissingListing();
        if (!isListingValid(collection, tokenId)) revert InvalidStatus();
        if (msg.sender == entry.seller) revert SelfTrade();
        if (entry.price > maxPrice) revert PriceAboveMaximum(entry.price, maxPrice);
        (uint256 fee, uint256 proceeds) = quoteFee(entry.price);
        _recordSale(collection, tokenId, entry.price, fee);
        _payFrom(msg.sender, entry.seller, proceeds, treasury, fee);
        IERC721(collection).safeTransferFrom(entry.seller, msg.sender, tokenId);
        emit Sold(collection, tokenId, entry.seller, msg.sender, entry.price, fee);
    }
    function getListing(address collection, uint256 tokenId) external view returns (Listing memory) {
        return _listings[collection][tokenId];
    }
    function quoteFee(uint256 price) public view returns (uint256 fee, uint256 sellerProceeds) {
        _requirePrice(price);
        fee = _fee(price, feeBps);
        sellerProceeds = price - fee;
    }
    function isListingValid(address collection, uint256 tokenId) public view returns (bool) {
        Listing memory entry = _listings[collection][tokenId];
        Collection memory info = collectionInfo[collection];
        if (!info.allowed || entry.seller == address(0) || block.timestamp >= entry.expiresAt) return false;
        if (_currentOwner(collection, tokenId) != entry.seller) return false;
        if (!_approved(collection, tokenId, entry.seller)) return false;
        return !info.hasExpiry || _expiryAfter(collection, tokenId, uint256(entry.expiresAt) + minExpiryBuffer);
    }
    function makeOffer(address collection, uint256 tokenId, uint256 price, uint256 duration) external whenNotPaused returns (uint256 id) {
        _allowed(collection);
        _requirePrice(price);
        if (duration < 1 hours || duration > 30 days) revert InvalidDuration();
        address seller = _currentOwner(collection, tokenId);
        if (seller == address(0)) revert NotTokenOwner();
        if (seller == msg.sender) revert SelfTrade();
        uint256 balance = usdc.balanceOf(msg.sender);
        uint256 allowance = usdc.allowance(msg.sender, address(this));
        if (balance < price || allowance < price) revert InsufficientFunds(msg.sender, price, balance, allowance);
        id = nextOfferId++;
        uint64 expiry = uint64(block.timestamp + duration);
        _offers[id] = Offer(msg.sender, collection, uint128(price), expiry, uint8(OfferStatus.Active), tokenId);
        emit OfferMade(id, msg.sender, collection, tokenId, price, expiry);
    }
    function cancelOffer(uint256 id) external {
        Offer storage entry = _activeOffer(id);
        if (entry.offerer != msg.sender) revert NotOfferer();
        entry.status = uint8(OfferStatus.Cancelled);
        emit OfferCancelled(id, msg.sender);
    }
    function rejectOffer(uint256 id) external {
        Offer storage entry = _activeOffer(id);
        _requireTokenOwner(entry.collection, entry.tokenId);
        entry.status = uint8(OfferStatus.Rejected);
        emit OfferRejected(id, msg.sender);
    }
    function acceptOffer(uint256 id) external nonReentrant whenNotPaused {
        Offer storage stored = _activeOffer(id);
        Offer memory entry = stored;
        if (block.timestamp >= entry.expiresAt) revert Expired();
        bool hasExpiry = _allowed(entry.collection);
        _requireTokenOwner(entry.collection, entry.tokenId);
        if (entry.offerer == msg.sender) revert SelfTrade();
        if (hasExpiry && !_expiryAfter(entry.collection, entry.tokenId, block.timestamp + minExpiryBuffer)) revert InvalidExpiry();
        uint256 fee = _fee(entry.price, feeBps);
        address recipient = treasury;
        if (recipient == address(0)) revert ZeroAddress();
        stored.status = uint8(OfferStatus.Accepted);
        _payFrom(entry.offerer, msg.sender, uint256(entry.price) - fee, recipient, fee);
        IERC721(entry.collection).safeTransferFrom(msg.sender, entry.offerer, entry.tokenId);
        _recordSale(entry.collection, entry.tokenId, entry.price, fee);
        emit OfferAccepted(id, msg.sender, entry.offerer, entry.price, fee);
    }
    function getOffer(uint256 id) external view returns (Offer memory) { _requireId(id, nextOfferId); return _offers[id]; }
    function createAuction(address collection, uint256 tokenId, uint256 startPrice, uint256 minIncrement, uint256 duration) external nonReentrant whenNotPaused returns (uint256 id) {
        bool hasExpiry = _allowed(collection);
        _requirePrice(startPrice);
        _requirePrice(minIncrement);
        if (duration < 1 hours || duration > 14 days) revert InvalidDuration();
        _requireTokenOwner(collection, tokenId);
        uint64 end = uint64(block.timestamp + duration);
        uint64 hard = end + uint64(24 hours);
        if (hasExpiry && !_expiryAfter(collection, tokenId, uint256(hard) + minExpiryBuffer)) revert InvalidExpiry();
        uint16 rate = feeBps;
        if (rate > MAX_FEE_BPS) revert InvalidFee();
        id = nextAuctionId++;
        Auction storage entry = _auctions[id];
        entry.seller = msg.sender;
        entry.collection = collection;
        entry.tokenId = tokenId;
        entry.startPrice = uint128(startPrice);
        entry.minIncrement = uint128(minIncrement);
        entry.endTime = end;
        entry.hardEnd = hard;
        entry.feeBps = rate;
        entry.hasExpiry = hasExpiry;
        _clearListing(collection, tokenId);
        _receivingId = id;
        _receiving = true;
        IERC721(collection).safeTransferFrom(msg.sender, address(this), tokenId);
        _receiving = false;
        delete _receivingId;
        if (_currentOwner(collection, tokenId) != address(this)) revert UnexpectedNFT();
        emit AuctionCreated(id, collection, tokenId, msg.sender, startPrice, minIncrement, end, hard, rate);
    }
    function bid(uint256 id, uint256 amount) external nonReentrant {
        Auction storage entry = _activeAuction(id);
        uint64 end = entry.endTime;
        if (block.timestamp >= end) revert Expired();
        if (entry.hasExpiry) _requireUnexpired(entry.collection, entry.tokenId);
        if (msg.sender == entry.seller) revert SelfTrade();
        _requirePrice(amount);
        uint256 required = _minimum(entry);
        if (amount < required) revert BidTooLow(amount, required);
        address previousBidder = entry.highestBidder;
        uint256 previousBid = entry.highestBid;
        entry.highestBidder = msg.sender;
        entry.highestBid = uint128(amount);
        if (end - block.timestamp < 10 minutes) {
            uint256 extended = block.timestamp + 10 minutes;
            if (extended > entry.hardEnd) extended = entry.hardEnd;
            if (extended > end) {
                entry.endTime = uint64(extended);
                emit AuctionExtended(id, uint64(extended));
            }
        }
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        if (previousBidder != address(0)) _pushOrCredit(previousBidder, previousBid);
        emit BidPlaced(id, msg.sender, amount);
    }
    function settle(uint256 id) external nonReentrant {
        Auction storage entry = _activeAuction(id);
        if (block.timestamp < entry.endTime) revert NotEnded();
        entry.status = uint8(AuctionStatus.Settled);
        uint256 fee;
        if (entry.highestBidder != address(0)) {
            if ((entry.hasExpiry && !_expiryAfter(entry.collection, entry.tokenId, block.timestamp))
                || !_deliver(entry.collection, entry.highestBidder, entry.tokenId)) {
                entry.status = uint8(AuctionStatus.Failed);
                _pushOrCredit(entry.highestBidder, entry.highestBid);
                emit AuctionFailed(id, entry.highestBidder, entry.highestBid);
                return;
            }
            fee = _fee(entry.highestBid, entry.feeBps);
            address recipient = treasury;
            if (recipient == address(0)) revert ZeroAddress();
            _pushOrCredit(entry.seller, uint256(entry.highestBid) - fee);
            if (fee != 0) _pushOrCredit(recipient, fee);
            _recordSale(entry.collection, entry.tokenId, entry.highestBid, fee);
        } else {
            if (!_deliver(entry.collection, entry.seller, entry.tokenId)) {
                entry.status = uint8(AuctionStatus.Failed);
                emit AuctionFailed(id, address(0), 0);
                return;
            }
        }
        emit AuctionSettled(id, entry.seller, entry.highestBidder, entry.highestBid, fee);
    }
    function cancelAuction(uint256 id, address to) external nonReentrant {
        Auction storage entry = _activeAuction(id);
        if (entry.seller != msg.sender) revert NotSeller();
        if (entry.highestBidder != address(0)) revert HasBids();
        if (to == address(0)) revert ZeroAddress();
        entry.status = uint8(AuctionStatus.Cancelled);
        if (!_deliver(entry.collection, to, entry.tokenId)) revert UnexpectedNFT();
        emit AuctionCancelled(id, msg.sender);
    }
    function claimUndelivered(uint256 id, address to) external nonReentrant {
        _requireId(id, nextAuctionId);
        Auction storage entry = _auctions[id];
        if (entry.seller != msg.sender) revert NotSeller();
        if (entry.status != uint8(AuctionStatus.Failed) || _undeliveredClaimed[id]) revert InvalidStatus();
        if (to == address(0)) revert ZeroAddress();
        if (_currentOwner(entry.collection, entry.tokenId) != address(this)) revert UnexpectedNFT();
        _undeliveredClaimed[id] = true;
        if (!_deliver(entry.collection, to, entry.tokenId)) revert UnexpectedNFT();
        emit UndeliveredClaimed(id, msg.sender);
    }
    function withdrawRefund() external nonReentrant {
        uint256 amount = pendingReturns[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        delete pendingReturns[msg.sender];
        usdc.safeTransfer(msg.sender, amount);
        emit RefundWithdrawn(msg.sender, amount);
    }
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata) external view override returns (bytes4) {
        Auction storage entry = _auctions[_receivingId];
        if (!_receiving || msg.sender != entry.collection || operator != address(this)
            || from != entry.seller || tokenId != entry.tokenId) revert UnexpectedNFT();
        return IERC721Receiver.onERC721Received.selector;
    }
    function getAuction(uint256 id) external view returns (Auction memory entry) {
        _requireId(id, nextAuctionId);
        entry = _auctions[id];
    }
    function minNextBid(uint256 id) external view returns (uint256) {
        _requireId(id, nextAuctionId);
        return _minimum(_auctions[id]);
    }
    function setRecord(address collection, uint256 tokenId, string calldata key, string calldata value) external {
        _requireRecordOwner(collection, tokenId);
        _set(collection, tokenId, key, value);
    }
    function setRecords(address collection, uint256 tokenId, string[] calldata keys, string[] calldata values) external {
        uint256 count = keys.length;
        if (count == 0 || count > MAX_BATCH || count != values.length) revert InvalidBatch();
        _requireRecordOwner(collection, tokenId);
        for (uint256 i; i < count; ++i) _set(collection, tokenId, keys[i], values[i]);
    }
    function getRecord(address collection, uint256 tokenId, string calldata key) external view returns (string memory) {
        _requireKey(key);
        Collection memory info = collectionInfo[collection];
        if (!info.allowed) return "";
        if (info.hasExpiry && !_expiryAfter(collection, tokenId, block.timestamp)) return "";
        address holder = _currentOwner(collection, tokenId);
        Record storage record = _records[collection][tokenId][key];
        if (holder == address(0) || record.setBy != holder) return "";
        return record.value;
    }
    function _validateListing(address collection, uint256 tokenId, uint256 price, uint256 duration)
        private view returns (uint64 expiry)
    {
        bool hasExpiry = _allowed(collection);
        _requirePrice(price);
        if (duration < 1 hours || duration > 365 days) revert InvalidDuration();
        _requireTokenOwner(collection, tokenId);
        if (!_approved(collection, tokenId, msg.sender)) revert NotApproved();
        expiry = uint64(block.timestamp + duration);
        if (hasExpiry && !_expiryAfter(collection, tokenId, uint256(expiry) + minExpiryBuffer)) revert InvalidExpiry();
    }
    function _clearListing(address collection, uint256 tokenId) private {
        address seller = _listings[collection][tokenId].seller;
        if (seller != address(0)) {
            delete _listings[collection][tokenId];
            emit ListingCancelled(collection, tokenId, seller);
        }
    }
    function _recordSale(address collection, uint256 tokenId, uint256 price, uint256 fee) internal {
        _clearListing(collection, tokenId);
        ++salesCount;
        totalVolume += price;
        totalFees += fee;
    }
    function _fee(uint256 price, uint16 rate) private pure returns (uint256) {
        if (rate > MAX_FEE_BPS) revert InvalidFee();
        return price * rate / BPS;
    }
    function _payFrom(address payer, address seller, uint256 proceeds, address recipient, uint256 fee) private {
        usdc.safeTransferFrom(payer, seller, proceeds);
        if (fee != 0) usdc.safeTransferFrom(payer, recipient, fee);
    }
    function _requireId(uint256 id, uint256 nextId) private pure {
        if (id == 0 || id >= nextId) revert InvalidId();
    }
    function _activeOffer(uint256 id) private view returns (Offer storage entry) {
        _requireId(id, nextOfferId);
        entry = _offers[id];
        if (entry.status != uint8(OfferStatus.Active)) revert InvalidStatus();
    }
    function _activeAuction(uint256 id) private view returns (Auction storage entry) {
        _requireId(id, nextAuctionId);
        entry = _auctions[id];
        if (entry.status != uint8(AuctionStatus.Active)) revert InvalidStatus();
    }
    function _minimum(Auction storage entry) private view returns (uint256) {
        return entry.highestBidder == address(0)
            ? uint256(entry.startPrice) : uint256(entry.highestBid) + entry.minIncrement;
    }
    function _deliver(address collection, address to, uint256 tokenId) private returns (bool) {
        try IERC721(collection).safeTransferFrom(address(this), to, tokenId) {
            return true;
        } catch {
            return false;
        }
    }
    function _pushOrCredit(address recipient, uint256 amount) private {
        bool paid;
        try usdc.transfer{gas: 80_000}(recipient, amount) returns (bool ok) { paid = ok; }
        catch { paid = false; }
        if (paid) {
            emit PaymentSent(recipient, amount);
        } else {
            pendingReturns[recipient] += amount;
            emit RefundCredited(recipient, amount);
        }
    }
    function _requireRecordOwner(address collection, uint256 tokenId) private view {
        bool hasExpiry = _allowed(collection);
        if (hasExpiry && !_expiryAfter(collection, tokenId, block.timestamp)) revert InvalidExpiry();
        _requireTokenOwner(collection, tokenId);
    }
    function _requireTokenOwner(address collection, uint256 tokenId) private view {
        if (_currentOwner(collection, tokenId) != msg.sender) revert NotTokenOwner();
    }
    function _requireKey(string calldata key) private pure {
        if (bytes(key).length == 0 || bytes(key).length > MAX_KEY_BYTES) revert InvalidKey();
    }
    function _set(address collection, uint256 tokenId, string calldata key, string calldata value) private {
        _requireKey(key);
        if (bytes(value).length > MAX_VALUE_BYTES) revert InvalidValue();
        if (bytes(value).length == 0) {
            delete _records[collection][tokenId][key];
        } else {
            _records[collection][tokenId][key] = Record(value, msg.sender);
        }
        emit RecordSet(collection, tokenId, keccak256(bytes(key)), key, value, msg.sender);
    }
    function _requireContract(address account) private view {
        if (account == address(0)) revert ZeroAddress();
        if (account.code.length == 0) revert NotContract();
    }
    function _requirePrice(uint256 price) private pure {
        if (price < MIN_PRICE || price > type(uint128).max) revert InvalidPrice(price, MIN_PRICE, type(uint128).max);
    }
    function _readExpiry(address collection, uint256 tokenId) private view returns (bool readable, uint256 expiry) {
        (bool ok, bytes memory data) = collection.staticcall(abi.encodeWithSignature("nameExpires(uint256)", tokenId));
        if (ok && data.length == 32) return (true, abi.decode(data, (uint256)));
        return (false, 0);
    }
    function _expiryAfter(address collection, uint256 tokenId, uint256 threshold) private view returns (bool) {
        (bool readable, uint256 expiry) = _readExpiry(collection, tokenId);
        return readable && expiry > threshold;
    }
    function _requireUnexpired(address collection, uint256 tokenId) private view {
        (bool readable, uint256 expiry) = _readExpiry(collection, tokenId);
        if (!readable) revert InvalidExpiry();
        if (expiry <= block.timestamp) revert NameExpired(expiry);
    }
    function _currentOwner(address collection, uint256 tokenId) private view returns (address) {
        if (collection.code.length == 0) return address(0);
        try IERC721(collection).ownerOf(tokenId) returns (address account) {
            return account;
        } catch {
            return address(0);
        }
    }
    function _approved(address collection, uint256 tokenId, address account) private view returns (bool) {
        try IERC721(collection).getApproved(tokenId) returns (address single) {
            if (single == address(this)) return true;
        } catch {}
        try IERC721(collection).isApprovedForAll(account, address(this)) returns (bool all) {
            return all;
        } catch {
            return false;
        }
    }
    function _allowed(address collection) private view returns (bool hasExpiry) {
        Collection memory info = collectionInfo[collection];
        if (!info.allowed) revert CollectionNotAllowed();
        return info.hasExpiry;
    }
}
