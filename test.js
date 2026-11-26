import { game, config, PROMPTS } from './server.js';

let failures = 0;
const check = (label, ok) => {
  console.log(ok ? 'PASS' : 'FAIL', label);
  if (!ok) failures++;
};
const REJECT = 'INVALID_MOVE';

// A clock we control, so people can arrive, leave and come back without waiting
let clock = 1_700_000_000_000;
Date.now = () => clock;
const advance = (ms) => { clock += ms; };

const random = { Shuffle: (a) => [...a].sort(() => Math.random() - 0.5) };

function newGame() {
  const ctx = { numPlayers: game.maxPlayers, currentPlayer: '0' };
  const G = game.setup({ ctx, random });
  const g = {
    G,
    play: (name, id, ...args) => game.moves[name].move({ G, ctx, playerID: id, random }, ...args),
    view: (id) => game.playerView({ G, ctx, playerID: id }),
    // These people open the game (their phones say "I'm here")
    join: (...ids) => ids.forEach((id) => g.play('here', id)),
    // Everybody in the round votes; `pick(voter)` says for whom
    voteAll: (pick) => G.roster.forEach((id) => g.play('vote', id, pick(id))),
  };
  return g;
}
const rows = (...ids) => ids; // readability

// ================= The prompts =================
{
  check('there are plenty of prompts, with no repeats', PROMPTS.length >= 120 && new Set(PROMPTS).size === PROMPTS.length);
  check('no prompt is empty or has stray spaces', PROMPTS.every((p) => p.length > 5 && p === p.trim()));
}

// ================= Setup: no fixed number of players =================
{
  const g = newGame();
  check('the game never ends', game.endIf === undefined);
  check('the room has seats for many players but needs nobody in particular', game.maxPlayers === config.seats && g.G.seats.length === config.seats);
  check('a new room starts in the lobby with nobody here', g.G.phase === 'lobby' && g.view(null).here.length === 0 && g.view(null).known.length === 0);
  check('the minimum to play is 3', config.minPlayers === 3 && g.view(null).minPlayers === 3);
}

// ================= Joining and leaving =================
{
  const g = newGame();
  check('a spectator cannot check in', g.play('here', null) === REJECT);
  check('a seat that does not exist cannot check in', g.play('here', '99') === REJECT && g.play('here', 5) === REJECT);
  g.join('3');
  check('checking in makes someone present, with a score of 0', g.view(null).here.join() === '3' && g.view(null).known.join() === '3' && g.view(null).scores['3'] === 0);
  advance(config.presenceMs + 1);
  check('someone not heard from for a while is gone, but remembered', g.view(null).here.length === 0 && g.view(null).known.join() === '3');
  g.G.scores['3'] = 7;
  g.join('3');
  check('they keep their score when they come back', g.view(null).here.join() === '3' && g.view(null).scores['3'] === 7);
  g.join('7', '12');
  check('anyone can join at any time, in any seat', g.view(null).here.length === 3 && g.view(null).known.length === 3);
  check('the TV and every phone see who is here', ['3', '7', null].every((id) => g.view(id).here.length === 3));
}

// ================= Tapping Leave =================
{
  const g = newGame();
  check('a spectator cannot say goodbye', g.play('goodbye', null) === REJECT && g.play('goodbye', '99') === REJECT);
  g.join('0', '1', '2', '3');
  g.play('goodbye', '3');
  check('saying goodbye makes someone gone at once, but remembered', !g.view(null).here.includes('3') && g.view(null).known.includes('3'));
  g.G.scores['3'] = 4;
  g.join('3');
  check('they come back with their score when they return', g.view(null).here.includes('3') && g.view(null).scores['3'] === 4);
  g.play('start', '0');
  g.play('vote', '0', '1'); g.play('vote', '1', '0'); g.play('vote', '2', '0');
  check('the round waits for player 3 while they are here', g.G.phase === 'voting');
  g.play('goodbye', '3');
  check('when they leave, the round does not wait for them', g.G.phase === 'revealed' && g.G.result.voters === 3);
}
{
  const g = newGame();
  g.join('0', '1', '2');
  g.play('start', '0');
  g.play('vote', '0', '1');
  g.play('goodbye', '1');
  check('when someone leaves a 3-player round it pauses instead of ending', g.G.phase === 'voting' && g.view('0').paused === true && g.view(null).paused === true);
  check('nobody scores and nothing is lost while it is paused', g.G.votes['0'] === '1' && g.G.scores['0'] === 0);
  g.join('1');
  check('it carries on when they come back', g.view('0').paused === false && g.G.phase === 'voting' && g.G.votes['0'] === '1');
}
{
  const g = newGame();
  g.join('0', '1', '2', '3');
  g.play('goodbye', '2'); g.play('goodbye', '3');
  check('people who left do not count towards the minimum to start', g.view('0').here.join() === '0,1' && g.view('0').canStart === false && g.play('start', '0') === REJECT);
}

// ================= Starting =================
{
  const g = newGame();
  g.join('0', '1');
  check('two players cannot start', g.view('0').canStart === false && g.play('start', '0') === REJECT && g.G.phase === 'lobby');
  g.join('2');
  check('three players can start', g.view('0').canStart === true && g.view(null).canStart === true);
  check('a spectator cannot start the game', g.play('start', null) === REJECT);
  check('nobody sees a prompt in the lobby', g.view('0').prompt === null && g.view(null).prompt === null);
  g.play('start', '1');
  check('the game starts with the players who are here', g.G.phase === 'voting' && g.G.round === 1 && g.G.roster.join() === '0,1,2');
  check('everyone sees the prompt', ['0', '1', '2', null].every((id) => typeof g.view(id).prompt === 'string'));
  check('starting twice is rejected', g.play('start', '0') === REJECT);
}
{
  const g = newGame();
  g.join('4', '9');
  advance(config.presenceMs + 1); // those two have gone
  g.join('1', '2');
  check('people who have gone do not count towards the minimum', g.view('1').canStart === false && g.play('start', '1') === REJECT);
  g.join('15');
  g.play('start', '15');
  check('a late arrival can start the game too', g.G.phase === 'voting' && g.G.roster.join() === '1,2,15');
}

// ================= Voting rules and privacy =================
{
  const g = newGame();
  g.join('0', '1', '2');
  g.play('start', '0');
  check('voting for yourself is rejected', g.play('vote', '0', '0') === REJECT);
  check('voting for someone who is not playing is rejected', g.play('vote', '0', '9') === REJECT);
  check('a non-text vote is rejected', g.play('vote', '0', 1) === REJECT);
  check('a spectator cannot vote', g.play('vote', null, '1') === REJECT);
  g.play('vote', '0', '1');
  check('voting twice is rejected', g.play('vote', '0', '2') === REJECT);

  const tv = g.view(null);
  check('the TV sees who has voted, but not who for', tv.votedBy['0'] === true && tv.votedBy['1'] === false && tv.myVote === null);
  check('another player does not see my vote', g.view('2').myVote === null);
  check('I can see my own vote', g.view('0').myVote === '1');
  check('no totals before the reveal', tv.result === null && g.view('0').result === null);
  check('no vote and no prompt deck is ever sent', ['0', '1', '2', null].every((id) => {
    const text = JSON.stringify(g.view(id));
    return !text.includes('"votes"') && !text.includes('"deck"') && !text.includes('"seen"');
  }));
  check('next is rejected while voting', g.play('next', '1', 1) === REJECT);
}

// ================= Scoring =================
{
  const g = newGame();
  g.join('0', '1', '2');
  g.play('start', '0');
  g.play('vote', '0', '1');
  g.play('vote', '2', '1');
  check('still voting until everyone has voted', g.G.phase === 'voting');
  g.play('vote', '1', '0');
  check('the reveal happens by itself after the last vote', g.G.phase === 'revealed');
  check('the player with the most votes wins the round', g.G.result.winners.join() === '1');
  check('players who voted with the crowd score a point', g.G.scores['0'] === 1 && g.G.scores['2'] === 1 && g.G.scores['1'] === 0);
  check('the winner gets a crown', g.G.crowns['1'] === 1 && g.G.crowns['0'] === 0);
  check('the totals are shown after the reveal', g.view(null).result.counts['1'] === 2 && g.view('2').result.agreed === 2);
  check('voting is closed after the reveal', g.play('vote', '0', '2') === REJECT);
  check('the round is remembered', g.view(null).recent.length === 1 && g.view(null).recent[0].winners.join() === '1');
}
{
  const g = newGame();
  g.join('0', '1', '2', '3');
  g.play('start', '0');
  g.play('vote', '0', '1'); g.play('vote', '1', '0'); g.play('vote', '2', '1'); g.play('vote', '3', '0');
  check('a tie shares the crown', g.G.result.winners.join() === '0,1' && g.G.crowns['0'] === 1 && g.G.crowns['1'] === 1);
  check('everyone who voted for a tied winner scores', ['0', '1', '2', '3'].every((id) => g.G.scores[id] === 1));
}

// ================= People joining mid-round =================
{
  const g = newGame();
  g.join('0', '1', '2');
  g.play('start', '0');
  g.join('5');
  const v = g.view('5');
  check('a newcomer is here but not in this round', v.here.includes('5') && v.inRound === false && v.roster.join() === '0,1,2');
  check('a newcomer cannot vote yet, and nobody can vote for them', g.play('vote', '5', '0') === REJECT && g.play('vote', '0', '5') === REJECT);
  check('a newcomer sees the prompt', v.prompt === g.G.prompt);
  g.voteAll((id) => (id === '0' ? '1' : '0'));
  check('the round finishes without waiting for the newcomer', g.G.phase === 'revealed');
  g.play('next', '5', 1);
  check('the newcomer can move on, and plays the next round', g.G.phase === 'voting' && g.G.round === 2 && g.G.roster.join() === '0,1,2,5');
  check('a newcomer starts on zero', g.G.scores['5'] === 0);
}

// ================= People leaving mid-round =================
{
  const g = newGame();
  g.join('0', '1', '2', '3');
  g.play('start', '0');
  g.play('vote', '0', '3'); g.play('vote', '1', '3'); g.play('vote', '2', '3');
  check('the round waits for player 3 while they are here', g.G.phase === 'voting');
  const half = Math.floor(config.presenceMs * 0.6);
  advance(half); g.join('0', '1', '2');
  check('still waiting a little while later', g.G.phase === 'voting');
  advance(half); g.join('0');
  check('when player 3 has gone, the round does not wait for them', g.G.phase === 'revealed');
  check('their votes and crowns still count', g.G.result.counts['3'] === 3 && g.G.result.winners.join() === '3' && g.G.crowns['3'] === 1);
  check('voters scored for agreeing with the crowd', ['0', '1', '2'].every((id) => g.G.scores[id] === 1));
}
{
  const g = newGame();
  g.join('0', '1', '2', '3');
  g.play('start', '0');
  g.play('vote', '3', '0');
  advance(config.presenceMs + 1); // 3 has voted and then left
  g.join('0', '1', '2');
  g.play('vote', '0', '1'); g.play('vote', '1', '0'); g.play('vote', '2', '0');
  check('a vote from someone who then left still counts', g.G.phase === 'revealed' && g.G.result.voters === 4 && g.G.result.counts['0'] === 3);
}
{
  // Phones fall asleep: the first one to wake must not cancel the round for everybody
  const g = newGame();
  g.join('0', '1', '2');
  g.play('start', '0');
  g.play('vote', '0', '1');
  advance(config.presenceMs + 1);
  g.join('0'); // 1 and 2 have gone quiet
  check('with too few left the round pauses instead of ending', g.G.phase === 'voting' && g.view('0').paused === true && g.view(null).paused === true);
  check('the first player back does not cancel the round', g.G.roster.join() === '0,1,2' && g.G.votes['0'] === '1');
  g.join('1', '2');
  check('the round carries on when they return', g.G.phase === 'voting' && g.view('0').paused === false && g.G.lowSince === null);
  g.play('vote', '1', '0'); g.play('vote', '2', '0');
  check('and finishes normally', g.G.phase === 'revealed');
}
{
  const g = newGame();
  g.join('0', '1', '2');
  g.play('start', '0');
  g.play('vote', '0', '1');
  advance(config.presenceMs + 1);
  g.join('0'); // paused
  advance(config.cancelAfterMs + 1);
  g.join('0');
  check('if too few players stay away for long, the round is cancelled', g.G.phase === 'lobby' && g.G.round === 1 && g.G.roster.length === 0);
  check('nobody scores in a cancelled round', ['0', '1', '2'].every((id) => g.G.scores[id] === 0) && g.G.crowns['0'] === 0);
  check('the lobby says what happened', /cancelled/.test(g.view(null).notice) && g.view('0').prompt === null && g.view(null).votedBy['0'] === undefined);
  g.join('1', '2');
  g.play('start', '1');
  check('and they can start again when enough are back', g.G.phase === 'voting' && g.G.round === 2 && g.G.votes['0'] === undefined && g.view('0').paused === false);
}

// ================= Revealing early =================
{
  const g = newGame();
  g.join('0', '1', '2', '3');
  g.play('start', '0');
  g.play('vote', '0', '1');
  check('no early reveal with one vote', g.view('0').canReveal === false && g.play('revealNow', '0') === REJECT);
  g.play('vote', '1', '0');
  check('early reveal is offered to voters once half have voted', g.view('0').canReveal === true && g.view('2').canReveal === false);
  check('someone who has not voted cannot reveal early', g.play('revealNow', '2') === REJECT);
  g.play('revealNow', '0');
  check('a voter can reveal early', g.G.phase === 'revealed' && g.G.result.voters === 2);
}

// ================= Moving on =================
{
  const g = newGame();
  g.join('0', '1', '2');
  g.play('start', '0');
  g.voteAll((id) => (id === '0' ? '1' : '0'));
  const first = g.G.prompt;
  check('a spectator cannot move on', g.play('next', null, 1) === REJECT);
  check('the wrong round number is rejected', g.play('next', '1', 5) === REJECT);
  g.play('next', '1', 1);
  check('the next round has fresh votes and a new prompt', g.G.phase === 'voting' && g.G.round === 2 && Object.keys(g.G.votes).length === 0 && g.G.prompt !== first);
  check('a repeated "next" for the old round is ignored', g.play('next', '2', 1) === REJECT);
  check('scores and crowns carry over between rounds', g.G.scores['1'] === 1 && g.G.scores['2'] === 1 && g.G.scores['0'] === 0 && g.G.crowns['0'] === 1);
}
{
  const g = newGame();
  g.join('0', '1', '2');
  g.play('start', '0');
  g.voteAll((id) => (id === '0' ? '1' : '0'));
  advance(config.presenceMs + 1);
  g.join('0', '1'); // 2 has left, leaving only two
  g.play('next', '0', 1);
  check('if fewer than 3 are left, moving on goes back to the lobby', g.G.phase === 'lobby' && /at least 3/.test(g.view(null).notice));
  check('scores are kept for when people return', g.view(null).known.join() === '0,1,2' && g.G.scores['1'] === 1);
  g.join('2');
  g.play('start', '2');
  check('and play carries on when someone returns', g.G.phase === 'voting' && g.G.round === 2);
}

// ================= The rounds never run out =================
{
  const g = newGame();
  g.join('0', '1', '2');
  g.play('start', '0');
  const seen = new Set();
  let previous = null, repeats = 0, still = true;
  const ROUNDS = PROMPTS.length * 2 + 30; // more than two whole decks
  for (let i = 1; i <= ROUNDS; i++) {
    if (g.G.phase !== 'voting' || g.G.round !== i) still = false;
    if (g.G.prompt === previous) repeats++;
    previous = g.G.prompt;
    seen.add(g.G.prompt);
    g.voteAll((id) => (id === '0' ? '1' : '0'));
    g.play('next', '0', i);
  }
  check(`${ROUNDS} rounds in a row, and the game is still going`, still && g.G.phase === 'voting' && g.G.round === ROUNDS + 1);
  check('every prompt was used', seen.size === PROMPTS.length);
  check('the same prompt never comes up twice in a row, even when the deck is reshuffled', repeats === 0);
  check('only the last few rounds are remembered', g.view(null).recent.length === config.recentKept);
}

// ================= A full room =================
{
  const g = newGame();
  const everyone = Array.from({ length: config.seats }, (_, i) => String(i));
  g.join(...everyone);
  check('every seat can be filled', g.view(null).here.length === config.seats);
  g.play('start', '0');
  check('everyone plays', g.G.roster.length === config.seats);
  g.voteAll((id) => String((Number(id) + 1) % config.seats));
  check('a round with a full room finishes, and everyone ties', g.G.phase === 'revealed' && g.G.result.winners.length === config.seats && everyone.every((id) => g.G.scores[id] === 1));
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);