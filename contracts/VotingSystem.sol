// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract VotingSystem {
    address public owner;
    uint256 public startTime;
    uint256 public endTime;
    uint256 public candidateCount;
    bool public isInitialized;

    mapping(uint256 => uint256) private voteCount;
    mapping(address => bool) private hasVotedMap;
    mapping(address => uint256) private voterChoiceMap;

    event ElectionSet(uint256 startTime, uint256 endTime);
    event CandidateAdded(uint256 candidateId);
    event Voted(address indexed voter, uint256 candidateId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setElection(uint256 _startTime, uint256 _endTime) external onlyOwner {
        require(_endTime > _startTime, "Invalid time range");
        require(!isInitialized || block.timestamp < startTime, "Election already started");
        require(candidateCount >= 2, "Need at least 2 candidates");

        startTime = _startTime;
        endTime = _endTime;
        isInitialized = true;

        emit ElectionSet(_startTime, _endTime);
    }

    function addCandidate() external onlyOwner {
        require(!isInitialized || block.timestamp < startTime, "Election already started");

        candidateCount++;
        emit CandidateAdded(candidateCount);
    }

    function vote(uint256 candidateId) external {
        require(getVoteStatus() == 2, "Election is not active");
        require(!hasVotedMap[msg.sender], "Already voted");
        require(candidateId >= 1 && candidateId <= candidateCount, "Invalid candidate");

        hasVotedMap[msg.sender] = true;
        voterChoiceMap[msg.sender] = candidateId;
        voteCount[candidateId]++;

        emit Voted(msg.sender, candidateId);
    }

    function getVoteStatus() public view returns (uint256) {
        if (!isInitialized) return 0;           // NOT_INITIALIZED
        if (block.timestamp < startTime) return 1;  // PENDING
        if (block.timestamp < endTime) return 2;    // ACTIVE
        return 3;                               // ENDED
    }

    function getVoteCount(uint256 candidateId) external view returns (uint256) {
        return voteCount[candidateId];
    }

    function getAllVoteCounts() external view returns (uint256[] memory) {
        uint256[] memory counts = new uint256[](candidateCount);
        for (uint256 i = 0; i < candidateCount; i++) {
            counts[i] = voteCount[i + 1];
        }
        return counts;
    }

    function getTotalVotes() external view returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 1; i <= candidateCount; i++) {
            total += voteCount[i];
        }
        return total;
    }

    function hasVotedAddress(address addr) external view returns (bool) {
        return hasVotedMap[addr];
    }

    function getVoterChoice(address addr) external view returns (uint256) {
        return voterChoiceMap[addr];
    }

    function getElectionPeriod() external view returns (uint256, uint256) {
        return (startTime, endTime);
    }
}
