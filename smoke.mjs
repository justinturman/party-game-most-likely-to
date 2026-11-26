// Runs public/view.js against a tiny fake page, fed with real views from the game
import fs from 'node:fs';
import vm from 'node:vm';
import { game, config } from './server.js';

const src = fs.readFileSync(new URL('./public/view.js', import.meta.url), 'utf8');
let clock = 1_700_000_000_000;
Date.now = () => clock;

function makePage() {
  let html = '';
  const posted = [];
  const timers = [];
  const buttons = {};
  const root = {
    get innerHTML() { return html; },
    set innerHTML(v) {
      html = v;
      for (const k of Object.keys(buttons)) delete buttons[k];
      for (const m of v.matchAll(/<button([^>]*)>/g)) {
        const attrs = m[1];
        const id = (attrs.match(/id="([\w]+)"/) || [])[1];
        const target = (attrs.match(/data-target="([^"]*)"/) || [])[1];
        const b = { disabled: /\sdisabled/.test(attrs), isConnected: true, dataset: target !== undefined ? { target } : {}, onclick: null };
        if (id) buttons['#' + id] = b;
        if (target !== undefined) (buttons['[data-target]'] ||= []).push(b);
      }
    },
    querySelectorAll: (sel) => buttons[sel] || [],
    querySelector: (sel) => buttons[sel] || null,
  };
  const handlers = {};
  const docHandlers = {};
  const parent = { postMessage: (m) => posted.push(m) };
  const ctx = {
    document: { getElementById: () => root, addEventListener: (t, f) => { docHandlers[t] = f; }, hidden: false },
    window: { addEventListener: (t, f) => { handlers[t] = f; } },
    parent, setInterval: (f) => timers.push(f), setTimeout: () => 0, console, Math, Number, String, Array, JSON, Set, Object,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { root, buttons, posted, timers, docHandlers,
    send: (data) => handlers.message({ source: parent, data }),
    get html() { return html; } };
}

const ctx = { numPlayers: game.maxPlayers, currentPlayer: '0' };
const random = { Shuffle: (a) => [...a] };
const G = game.setup({ ctx, random });
const names = Object.fromEntries(G.seats.map((id) => [id, ['Ann', 'Bo<b>', 'Cy', 'Di', 'Ed', 'Flo'][Number(id)] || `Player ${Number(id) + 1}`]));
const play = (n, id, ...a) => game.moves[n].move({ G, ctx, playerID: id, random }, ...a);
const msg = (id, view) => ({ type: 'state', view, playerID: id, names, state: { G: game.playerView({ G, ctx, playerID: id }), ctx } });

let fails = 0;
const ok = (label, cond) => { console.log(cond ? 'PASS' : 'FAIL', label); if (!cond) fails++; };

const tv = makePage();
const ph = { 0: makePage(), 1: makePage(), 2: makePage(), 4: makePage() };
const feed = () => { tv.send(msg(null, 'public')); for (const [id, p] of Object.entries(ph)) p.send(msg(id, 'player')); };

feed();
ok('an empty room says nobody is here', /Nobody here yet/.test(tv.html) && /0 here · need at least 3/.test(tv.html));
const hellos = (p) => p.posted.filter((m) => m.name === 'here').length;
ok('each phone says hello as soon as it opens', Object.values(ph).every((p) => hellos(p) === 1));
ok('the TV never says hello', hellos(tv) === 0);
ph[0].timers.forEach((f) => f()); ph[0].timers.forEach((f) => f());
ok('a phone keeps saying hello on a timer', ph[0].posted.filter((m) => m.name === 'here').length >= 2);
ph[1].docHandlers.visibilitychange();
ok('and when it wakes up', ph[1].posted.filter((m) => m.name === 'here').length === 2);

for (const id of ['0', '1']) play('here', id);
feed();
ok('two players is not enough, and the Start button is off', /2 here/.test(tv.html) && ph[0].buttons['#start'].disabled === true && /Waiting for 1 more player…/.test(ph[0].html));
play('here', '2');
feed();
ok('three players can start', ph[0].buttons['#start'].disabled === false && /3 players here/.test(tv.html) && /Anyone can tap/.test(tv.html));
ok('names are escaped', tv.html.includes('Bo&lt;b&gt;') && !tv.html.includes('Bo<b>'));
ph[0].buttons['#start'].onclick();
ok('the Start button asks to start', JSON.stringify(ph[0].posted.at(-1)) === JSON.stringify({ type: 'move', name: 'start', args: [] }));

play('start', '0');
play('here', '4'); // arrives mid-round
feed();
ok('the TV shows the prompt and who has voted', /Who is most likely to/.test(tv.html) && /0 of 3 have voted/.test(tv.html) && /🤔 thinking/.test(tv.html));
ok('the TV shows who is waiting to join next round', /Joining next round/.test(tv.html) && /Ed/.test(tv.html));
ok('a newcomer is told to wait and cannot vote', /already under way/.test(ph[4].html) && !ph[4].buttons['#sendVote']);
const targets = ph[0].buttons['[data-target]'];
ok('a player can pick anyone in the round except themselves', targets.length === 2 && ph[0].html.includes('Bo&lt;b&gt;') && !/data-target="0"/.test(ph[0].html));
targets[1].onclick();
ok('picking someone enables the Vote button', ph[0].buttons['#sendVote'] && ph[0].buttons['#sendVote'].disabled === false);
ph[0].buttons['#sendVote'].onclick();
ok('voting posts the vote', JSON.stringify(ph[0].posted.at(-1)) === JSON.stringify({ type: 'move', name: 'vote', args: ['2'] }));

play('vote', '0', '2'); feed();
ok('after voting a player waits and sees their own vote', /You voted for/.test(ph[0].html) && /1 of 3 voted/.test(ph[0].html));
ok('the TV never shows who voted for whom', !/voted for/.test(tv.html));

// A player goes to sleep: their button is greyed out for everyone else
clock += config.presenceMs + 1;
play('here', '0'); play('here', '1'); play('here', '4');
feed();
ok('a player who has gone is dimmed and cannot be picked', /disabled>Cy 💤/.test(ph[1].html) || /Cy 💤/.test(ph[1].html));
ok('with someone missing the TV is patient', /Waiting for players to come back/.test(tv.html) === (G.lowSince !== null));
play('here', '2'); play('here', '1'); play('vote', '1', '2'); play('vote', '2', '0'); feed();
ok('the reveal shows the totals and a crown', G.phase === 'revealed' && /👑/.test(tv.html) && /voted with the crowd/.test(tv.html));
ok('every phone has a Next round button', ph[0].buttons['#next'] && ph[1].buttons['#next'] && /joined during this round/.test(ph[4].html));
ph[4].buttons['#next'].onclick();
ok('a newcomer can move the game on', JSON.stringify(ph[4].posted.at(-1)) === JSON.stringify({ type: 'move', name: 'next', args: [1] }));
play('next', '4', 1); feed();
ok('the next round includes the newcomer', G.roster.includes('4') && ph[4].buttons['#sendVote'] !== undefined && /Round 2/.test(tv.html));

// Tapping Leave: the game is told straight away, and the phone stops saying hello
const leaver = makePage();
leaver.send(msg('0', 'player'));
const hb = hellos(leaver);
leaver.send({ type: 'leaving' });
ok('tapping Leave tells the game goodbye', JSON.stringify(leaver.posted.at(-1)) === JSON.stringify({ type: 'move', name: 'goodbye', args: [] }));
leaver.timers.forEach((f) => f());
leaver.docHandlers.visibilitychange();
ok('and the phone stops saying hello while it leaves', hellos(leaver) === hb);
const tvLeave = makePage(); tvLeave.send(msg(null, 'public')); tvLeave.send({ type: 'leaving' });
ok('the TV ignores Leave', tvLeave.posted.filter((m) => m.name === 'goodbye').length === 0);
const fresh = makePage(); fresh.send(msg('1', 'player')); fresh.send({ type: 'something-else' });
ok('other messages are ignored', fresh.posted.filter((m) => m.name === 'goodbye').length === 0);

// Flipping to the TV view on a phone must not send hellos; coming back does
const flip = makePage();
flip.send(msg('0', 'player')); const n1 = flip.posted.length;
flip.send(msg(null, 'public'));
flip.timers.forEach((f) => f());
ok('the TV view on a phone sends no hellos', flip.posted.length === n1);
flip.send(msg('0', 'player'));
ok('coming back to the phone view says hello again', flip.posted.length === n1 + 1);

console.log(fails ? `\n${fails} smoke check(s) FAILED` : '\nSmoke test passed.');
process.exit(fails ? 1 : 0);