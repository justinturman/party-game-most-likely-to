import { PROMPTS } from './prompts.js';

const INVALID_MOVE = 'INVALID_MOVE';

export { PROMPTS };

export const config = {
  minPlayers: 3, // needed to start a round, and to keep one going
  seats: 20, // the most phones in one room at the same time
  presenceMs: 45000, // someone who has not been heard from for this long counts as gone
  cancelAfterMs: 90000, // a round with too few players left is paused, and only cancelled after this long
  recentKept: 5, // how many past rounds the TV can recall
};

// ---------------------------------------------------------------------------------
// WHO IS HERE?
// The platform lets people join and leave whenever, but the rules never hear about it.
// So every phone sends a small "I'm here" move every few seconds (and whenever it votes),
// and says goodbye when the player taps Leave. Anyone not heard from recently counts as gone.
// Seats are fixed, people are not.
// ---------------------------------------------------------------------------------
const isSeat = (G, id) => typeof id === 'string' && G.seats.includes(id);
const isHere = (G, id, now = Date.now()) => G.seen[id] !== undefined && now - G.seen[id] <= config.presenceMs;
const hereNow = (G, now = Date.now()) => G.seats.filter((id) => isHere(G, id, now));

function touch(G, id) {
  G.seen[id] = Date.now();
  if (G.scores[id] === undefined) {
    G.scores[id] = 0; // a newcomer starts on zero...
    G.crowns[id] = 0; // ...and keeps their points if they leave and come back
  }
}

// ---------------------------------------------------------------------------------
// ROUNDS
// ---------------------------------------------------------------------------------
function nextPrompt(G, random) {
  if (G.deckPos >= G.deck.length) {
    let deck = random.Shuffle([...PROMPTS]);
    if (deck[0] === G.lastPrompt) deck = [...deck.slice(1), deck[0]]; // never the same one twice in a row
    G.deck = deck;
    G.deckPos = 0;
  }
  const p = G.deck[G.deckPos];
  G.deckPos += 1;
  G.lastPrompt = p;
  return p;
}

function toLobby(G, notice) {
  G.phase = 'lobby';
  G.roster = [];
  G.votes = {};
  G.result = null;
  G.prompt = null;
  G.lowSince = null;
  G.notice = notice || null;
}

// Everyone who is here right now plays; anyone who arrives later waits for the next round
function startRound(G, random) {
  G.round += 1;
  G.roster = hereNow(G);
  G.votes = {};
  G.result = null;
  G.notice = null;
  G.lowSince = null;
  G.prompt = nextPrompt(G, random);
  G.phase = 'voting';
}

// Counts the votes, crowns the winner(s), and scores the players who agreed with the crowd
function reveal(G) {
  const counts = {};
  for (const id of G.roster) counts[id] = 0;
  for (const target of Object.values(G.votes)) counts[target] += 1;
  const top = Math.max(...Object.values(counts));
  const winners = G.roster.filter((id) => counts[id] === top);
  let agreed = 0;
  for (const [voter, target] of Object.entries(G.votes)) {
    if (winners.includes(target)) {
      G.scores[voter] += 1;
      agreed += 1;
    }
  }
  for (const id of winners) G.crowns[id] += 1;
  G.result = { counts, winners, agreed, voters: Object.keys(G.votes).length };
  G.recent.unshift({ round: G.round, prompt: G.prompt, winners });
  if (G.recent.length > config.recentKept) G.recent.pop();
  G.phase = 'revealed';
}

// Runs after anything that could change who is here or who has voted
function settle(G) {
  if (G.phase !== 'voting') return;
  const stillHere = G.roster.filter((id) => isHere(G, id));
  if (stillHere.length < config.minPlayers) {
    // Nobody is dropped at the first sign of trouble: phones fall asleep and people pop out for
    // a minute. The round just waits, and is only cancelled if it stays that way.
    if (G.lowSince === null) G.lowSince = Date.now();
    else if (Date.now() - G.lowSince > config.cancelAfterMs) {
      toLobby(G, 'Too many players left, so that round was cancelled. Nobody scored.');
    }
    return;
  }
  G.lowSince = null;
  // Votes are in from everyone who is still here (people who left do not hold things up)
  if (stillHere.every((id) => G.votes[id] !== undefined)) reveal(G);
}

export const game = {
  name: 'most-likely-to',
  // The platform makes one room with this many seats. Nobody has to fill them: the real
  // player count is whoever is here, and it can change at any time.
  minPlayers: config.seats,
  maxPlayers: config.seats,

  // Everyone acts at the same time.
  // Without this, boardgame.io only lets player 0 make moves.
  turn: { activePlayers: { all: null } },

  setup: ({ ctx, random }) => ({
    phase: 'lobby', // lobby -> voting -> revealed -> voting -> ... (it never ends)
    seats: Array.from({ length: ctx.numPlayers }, (_, i) => String(i)),
    seen: {}, // seat id -> when we last heard from that phone (never sent to anyone)
    scores: {}, // only for players who have joined
    crowns: {},
    deck: random.Shuffle([...PROMPTS]), // never sent to anyone
    deckPos: 0,
    lastPrompt: null,
    round: 0,
    prompt: null,
    roster: [], // who is playing this round
    lowSince: null, // when a round first had too few players left
    votes: {}, // voter id -> the id they voted for (secret until the reveal)
    result: null,
    recent: [],
    notice: null,
  }),

  moves: {
    // "I'm here": sent by every phone every few seconds
    here: {
      client: false,
      move: ({ G, playerID }) => {
        if (!isSeat(G, playerID)) return INVALID_MOVE;
        touch(G, playerID);
        settle(G);
      },
    },

    // Sent when a player taps Leave, so nobody waits for them
    goodbye: {
      client: false,
      move: ({ G, playerID }) => {
        if (!isSeat(G, playerID)) return INVALID_MOVE;
        G.seen[playerID] = 0; // gone at once, instead of after the presence timeout
        settle(G);
      },
    },

    // Start playing, once enough people are here
    start: {
      client: false,
      move: ({ G, playerID, random }) => {
        if (G.phase !== 'lobby' || !isSeat(G, playerID)) return INVALID_MOVE;
        touch(G, playerID);
        if (hereNow(G).length < config.minPlayers) return INVALID_MOVE;
        startRound(G, random);
      },
    },

    // Votes are secret, so this only runs on the server
    vote: {
      client: false,
      move: ({ G, playerID }, target) => {
        if (G.phase !== 'voting' || !isSeat(G, playerID)) return INVALID_MOVE;
        if (!G.roster.includes(playerID)) return INVALID_MOVE; // joined mid-round: wait for the next one
        if (!G.roster.includes(target) || target === playerID) return INVALID_MOVE;
        if (G.votes[playerID] !== undefined) return INVALID_MOVE; // one vote each
        touch(G, playerID);
        G.votes[playerID] = target;
        settle(G);
      },
    },

    // Fallback for someone who is here but not voting: once at least half of the players still
    // here have voted (and at least two), someone who has voted can end the voting.
    revealNow: {
      client: false,
      move: ({ G, playerID }) => {
        if (G.phase !== 'voting' || G.votes[playerID] === undefined) return INVALID_MOVE;
        const n = Object.keys(G.votes).length;
        const stillHere = G.roster.filter((id) => isHere(G, id));
        if (n < 2 || n * 2 < stillHere.length) return INVALID_MOVE;
        touch(G, playerID);
        reveal(G);
      },
    },

    // Anyone here can move on. The round number stops a late second tap skipping a round.
    next: {
      client: false,
      move: ({ G, playerID, random }, round) => {
        if (G.phase !== 'revealed' || !isSeat(G, playerID) || round !== G.round) return INVALID_MOVE;
        touch(G, playerID);
        if (hereNow(G).length >= config.minPlayers) startRound(G, random);
        else toLobby(G, `Waiting for at least ${config.minPlayers} players.`);
      },
    },
  },

  // THE PRIVACY RULES:
  //  - nobody ever receives who voted for whom, only who has voted
  //  - the totals are sent only after the reveal
  //  - a player's own vote goes only to that player
  //  - the shuffled prompt deck is never sent
  playerView: ({ G, playerID }) => {
    const seat = isSeat(G, playerID);
    const here = hereNow(G);
    const votedBy = {};
    for (const id of G.roster) votedBy[id] = G.votes[id] !== undefined;
    const votedCount = G.roster.filter((id) => votedBy[id]).length;
    const stillHere = G.roster.filter((id) => here.includes(id));
    const myVote = seat && G.votes[playerID] !== undefined ? G.votes[playerID] : null;
    return {
      phase: G.phase,
      round: G.round,
      minPlayers: config.minPlayers,
      role: seat ? 'player' : 'spectator',
      prompt: G.phase === 'lobby' ? null : G.prompt,
      known: Object.keys(G.scores), // everyone who has joined at some point
      here, // everyone who is here right now
      roster: G.roster, // who is playing this round
      inRound: seat && G.roster.includes(playerID),
      paused: G.phase === 'voting' && G.lowSince !== null, // waiting for people to come back
      votedBy,
      votedCount,
      myVote,
      canStart: G.phase === 'lobby' && here.length >= config.minPlayers,
      canReveal: G.phase === 'voting' && myVote !== null && votedCount >= 2 && votedCount * 2 >= stillHere.length,
      result: G.phase === 'revealed' ? G.result : null,
      scores: G.scores,
      crowns: G.crowns,
      recent: G.recent,
      notice: G.notice,
    };
  },
};