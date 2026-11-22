const INVALID_MOVE = 'INVALID_MOVE';

const ROUNDS = 8;

// Prompts finish the sentence "Who is most likely to ...?"
const PROMPTS = [
  'survive a zombie apocalypse',
  'become famous',
  'fall asleep first at a party',
  'win a reality TV show',
  'get arrested for something dumb',
  'trip over nothing',
  'become a millionaire',
  'be on a soap opera',
  'forget their own birthday',
  'cry at a movie',
  'become a chef',
  'lie about reading the book',
  'start a cult',
  'go viral',
  'marry a celebrity',
  'become a hermit',
  'give the best advice',
  'laugh at the wrong moment',
  'forget their own birthday',
  'get lost in their own neighborhood',
  'win a hot-dog eating contest',
  'cry at a commercial',
  'fall asleep during a movie',
  'talk their way out of a speeding ticket',
  'send a text to the wrong person',
  'adopt ten pets',
  'show up late to their own party',
  'start a successful business',
  'eat dessert before dinner',
  'sing in the shower',
  'break something expensive',
  'move to another country',
  'binge-watch a whole series in one night',
  'win a game show',
  'get a tattoo on a whim',
  'chat with a stranger on a plane',
  'forget where they parked',
  'set off the smoke alarm while cooking',
  'keep a secret forever',
  'lose their phone',
  'dance when nobody asked',
  'write a book',
  'tell the same story twice',
  'stay up all night',
  'start a fight over a board game',
  'take the last slice',
  'be a great spy',
  'rescue a stray animal',
  'run a marathon',
  'plan the perfect trip',
  'pretend to know what is going on',
  'bring snacks to everything',
  'overshare with a stranger',
  'quote a movie at a serious moment',
  'become a superhero',
  'win an argument they started'
];

function startRound(G) {
  G.votes = {};
  G.result = null;
  G.phase = 'voting';
}

// Counts the votes, crowns the winner(s), and scores the players who agreed with the crowd
function reveal(G) {
  const counts = {};
  for (const id of G.players) counts[id] = 0;
  for (const target of Object.values(G.votes)) counts[target] += 1;
  const top = Math.max(...Object.values(counts));
  const winners = G.players.filter((id) => counts[id] === top);
  let agreed = 0;
  for (const [voter, target] of Object.entries(G.votes)) {
    if (winners.includes(target)) {
      G.scores[voter] += 1;
      agreed += 1;
    }
  }
  for (const id of winners) G.crowns[id] += 1;
  G.result = { counts, winners, agreed, voters: Object.keys(G.votes).length };
  G.history.push({ prompt: G.prompts[G.round], winners });
  G.phase = 'revealed';
}

export const game = {
  name: 'most-likely-to',
  minPlayers: 3,
  maxPlayers: 10,

  // Everyone votes at the same time.
  // Without this, boardgame.io only lets player 0 make moves.
  turn: { activePlayers: { all: null } },

  setup: ({ ctx, random }) => {
    const players = Array.from({ length: ctx.numPlayers }, (_, i) => String(i));
    const scores = {};
    const crowns = {};
    for (const id of players) {
      scores[id] = 0;
      crowns[id] = 0;
    }
    const prompts = random.Shuffle(PROMPTS).slice(0, ROUNDS);
    return {
      phase: 'voting', // voting -> revealed -> (next round) -> ... -> gameover
      players,
      prompts,
      round: 0,
      total: prompts.length,
      votes: {}, // voter id -> the id they voted for (secret until the reveal)
      result: null,
      scores,
      crowns,
      history: [], // one entry per finished round
    };
  },

  moves: {
    // Votes are secret, so this only runs on the server
    vote: {
      client: false,
      move: ({ G, playerID }, target) => {
        if (G.phase !== 'voting') return INVALID_MOVE;
        if (!G.players.includes(playerID)) return INVALID_MOVE; // spectators can't vote
        if (!G.players.includes(target) || target === playerID) return INVALID_MOVE;
        if (G.votes[playerID] !== undefined) return INVALID_MOVE; // one vote each
        G.votes[playerID] = target;
        // When everyone has voted, reveal straight away
        if (Object.keys(G.votes).length === G.players.length) reveal(G);
      },
    },

    // Fallback for a player who has wandered off: once at least half the players
    // (and at least two) have voted, someone who has voted can end the voting.
    revealNow: {
      client: false,
      move: ({ G, playerID }) => {
        if (G.phase !== 'voting') return INVALID_MOVE;
        if (G.votes[playerID] === undefined) return INVALID_MOVE;
        const n = Object.keys(G.votes).length;
        if (n < 2 || n * 2 < G.players.length) return INVALID_MOVE;
        reveal(G);
      },
    },

    // Any player can move on. The round number stops a late second tap skipping a round.
    next: {
      client: false,
      move: ({ G, playerID }, round) => {
        if (G.phase !== 'revealed') return INVALID_MOVE;
        if (!G.players.includes(playerID)) return INVALID_MOVE;
        if (round !== G.round) return INVALID_MOVE;
        G.round += 1;
        if (G.round >= G.total) {
          G.phase = 'gameover';
          return;
        }
        startRound(G);
      },
    },
  },

  // THE PRIVACY RULES:
  //  - nobody ever receives who voted for whom, only who has voted
  //  - the totals are sent only after the reveal
  //  - a player's own vote goes only to that player
  //  - upcoming prompts and the round history are not sent until they are due
  playerView: ({ G, playerID }) => {
    const isPlayer = playerID !== null && playerID !== undefined;
    const votedBy = {};
    for (const id of G.players) votedBy[id] = G.votes[id] !== undefined;
    const votedCount = Object.keys(G.votes).length;
    const myVote = isPlayer && G.votes[playerID] !== undefined ? G.votes[playerID] : null;
    return {
      phase: G.phase,
      round: G.round,
      total: G.total,
      prompt: G.phase === 'gameover' ? null : G.prompts[G.round],
      players: G.players,
      votedBy,
      votedCount,
      myVote,
      canReveal:
        G.phase === 'voting' &&
        myVote !== null &&
        votedCount >= 2 &&
        votedCount * 2 >= G.players.length,
      result: G.phase === 'revealed' ? G.result : null,
      scores: G.scores,
      crowns: G.crowns,
      history: G.phase === 'gameover' ? G.history : [],
    };
  },

  endIf: ({ G }) => {
    if (G.phase !== 'gameover') return;
    const best = Math.max(...Object.values(G.scores));
    return { winners: G.players.filter((id) => G.scores[id] === best) };
  },
};