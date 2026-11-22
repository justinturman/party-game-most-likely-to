import { game } from './server.js';

let failures = 0;
const check = (label, ok) => {
  console.log(ok ? 'PASS' : 'FAIL', label);
  if (!ok) failures++;
};

const random = { Shuffle: (a) => [...a].sort(() => Math.random() - 0.5) };

function newGame(n = 3) {
  const ctx = { numPlayers: n, currentPlayer: '0' };
  const G = game.setup({ ctx, random });
  return {
    G,
    play: (name, playerID, ...args) =>
      game.moves[name].move({ G, ctx, playerID, random }, ...args),
    view: (playerID) => game.playerView({ G, ctx, playerID }),
    over: () => game.endIf({ G, ctx }),
  };
}
const ids = (n) => Array.from({ length: n }, (_, i) => String(i));

// ---- Setup ----
{
  const g = newGame(3);
  check('a game has 8 different prompts', g.G.total === 8 && new Set(g.G.prompts).size === 8);
  check('everyone starts on 0 points and 0 crowns',
    ids(3).every((id) => g.G.scores[id] === 0 && g.G.crowns[id] === 0));
}

// ---- Voting rules and privacy ----
{
  const g = newGame(3);
  check('voting for yourself is rejected', g.play('vote', '0', '0') === 'INVALID_MOVE');
  check('voting for someone who does not exist is rejected', g.play('vote', '0', '9') === 'INVALID_MOVE');
  check('a non-text vote is rejected', g.play('vote', '0', 1) === 'INVALID_MOVE');
  check('a spectator cannot vote', g.play('vote', null, '1') === 'INVALID_MOVE');
  g.play('vote', '0', '1');
  check('voting twice is rejected', g.play('vote', '0', '2') === 'INVALID_MOVE');

  const tv = g.view(null);
  check('the TV sees who has voted, but not who for', tv.votedBy['0'] === true && tv.votedBy['1'] === false && tv.myVote === null);
  check('another player does not see my vote', g.view('2').myVote === null);
  check('I can see my own vote', g.view('0').myVote === '1');
  check('no totals before the reveal', tv.result === null);
  check('no round history during play', tv.history.length === 0);
  check('next is rejected while voting', g.play('next', '1', 0) === 'INVALID_MOVE');
}

// ---- Scoring: a clear winner ----
{
  const g = newGame(3);
  g.play('vote', '0', '1');
  g.play('vote', '2', '1');
  check('still voting until everyone has voted', g.G.phase === 'voting');
  g.play('vote', '1', '0');
  check('the reveal happens by itself after the last vote', g.G.phase === 'revealed');
  check('the player with the most votes wins the round', g.G.result.winners.length === 1 && g.G.result.winners[0] === '1');
  check('players who voted with the crowd score a point',
    g.G.scores['0'] === 1 && g.G.scores['2'] === 1 && g.G.scores['1'] === 0);
  check('the winner gets a crown', g.G.crowns['1'] === 1 && g.G.crowns['0'] === 0);
  check('the totals are shown after the reveal', g.view(null).result.counts['1'] === 2);
  check('voting is closed after the reveal', g.play('vote', '0', '2') === 'INVALID_MOVE');
}

// ---- Scoring: a tie ----
{
  const g = newGame(4);
  g.play('vote', '0', '1');
  g.play('vote', '1', '0');
  g.play('vote', '2', '1');
  g.play('vote', '3', '0');
  check('a tie shares the crown', g.G.result.winners.length === 2 && g.G.crowns['0'] === 1 && g.G.crowns['1'] === 1);
  check('everyone who voted for a tied winner scores', ids(4).every((id) => g.G.scores[id] === 1));
}

// ---- Early reveal ----
{
  const g = newGame(4);
  g.play('vote', '0', '1');
  check('no early reveal with one vote', g.view('0').canReveal === false);
  g.play('vote', '1', '0');
  check('early reveal is offered to voters once half have voted',
    g.view('0').canReveal === true && g.view('2').canReveal === false);
  check('a player who has not voted cannot reveal early', g.play('revealNow', '2') === 'INVALID_MOVE');
  g.play('revealNow', '0');
  check('a voter can reveal early', g.G.phase === 'revealed' && g.G.result.voters === 2);
}

// ---- A whole game ----
{
  const g = newGame(3);
  check('next from a spectator is rejected once revealed',
    (() => {
      for (const id of ids(3)) g.play('vote', id, id === '0' ? '1' : '0');
      return g.play('next', null, 0) === 'INVALID_MOVE';
    })());
  check('next with the wrong round is rejected', g.play('next', '1', 5) === 'INVALID_MOVE');
  g.play('next', '1', 0);
  check('the next round starts with fresh votes', g.G.phase === 'voting' && g.G.round === 1 && Object.keys(g.G.votes).length === 0);
  check('a repeated next for the old round is ignored', g.play('next', '2', 0) === 'INVALID_MOVE');

  for (let round = 1; round < 8; round++) {
    for (const id of ids(3)) g.play('vote', id, id === '0' ? '1' : '0');
    g.play('next', '2', round);
  }
  check('the game ends after 8 rounds', g.G.phase === 'gameover');
  check('player 0 won every round', g.G.crowns['0'] === 8);
  const result = g.over();
  check('players 1 and 2 tie for the most points', !!result && result.winners.join(',') === '1,2');
  const tv = g.view(null);
  check('the round history is shown at the end', tv.history.length === 8 && tv.prompt === null);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);