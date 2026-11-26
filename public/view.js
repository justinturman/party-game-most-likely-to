(function () {
  const root = document.getElementById('root');

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  const send = (name, ...args) => parent.postMessage({ type: 'move', name, args }, '*');
  const nm = (names, id) => esc(names[id] || `Player ${Number(id) + 1}`);

  let last = null; // the most recent message from the platform
  let voteSel = null; // the player tapped but not yet confirmed
  let selRound = null;
  let lastView = null;

  // ---------------- "I'm here" ----------------
  // The platform lets people come and go, but the game only knows who is here because every
  // phone says so every few seconds (and straight away when it wakes up), and says goodbye
  // when the player taps Leave.
  let leaving = false;
  const isPlayerView = () => last && last.view === 'player' && last.state.G.role === 'player';
  const beat = () => {
    if (!leaving && isPlayerView()) send('here');
  };
  setInterval(beat, 10000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) beat();
  });

  const hereSet = (S) => new Set(S.here);
  const away = (S, id) => (hereSet(S).has(id) ? '' : ' away');

  // Everyone who has ever joined, best first. People who have gone are shown dimmed.
  function scoreboard(S, names) {
    if (!S.known.length) return '';
    const ids = [...S.known].sort(
      (a, b) => S.scores[b] - S.scores[a] || S.crowns[b] - S.crowns[a]
    );
    return (
      '<div class="players">' +
      ids
        .map(
          (id) =>
            `<div class="player${away(S, id)}"><h3>${nm(names, id)}${hereSet(S).has(id) ? '' : ' 💤'}</h3><p>${S.scores[id]} pts</p><p>${S.crowns[id]} 👑</p></div>`
        )
        .join('') +
      '</div>'
    );
  }

  function chips(S, names, ids) {
    return ids.map((id) => `<span class="chip">${nm(names, id)}</span>`).join('');
  }

  function promptHTML(S) {
    return `<p class="lead">Who is most likely to…</p>
      <h1 class="prompt">${esc(S.prompt)}?</h1>
      <p class="progress">Round ${S.round}</p>`;
  }

  function resultHTML(S, names) {
    const r = S.result;
    const max = Math.max(1, ...Object.values(r.counts));
    const ids = [...S.roster].sort((a, b) => r.counts[b] - r.counts[a]);
    return (
      '<div class="results">' +
      ids
        .map((id) => {
          const win = r.winners.includes(id);
          const pct = Math.round((r.counts[id] / max) * 100);
          return `<div class="rrow${win ? ' win' : ''}">
            <span class="rname">${win ? '👑 ' : ''}${nm(names, id)}</span>
            <span class="track"><span class="fill" style="width:${pct}%"></span></span>
            <span class="rcount">${r.counts[id]}</span></div>`;
        })
        .join('') +
      '</div>'
    );
  }

  function winnersLine(S, names) {
    const r = S.result;
    const who = r.winners.map((id) => nm(names, id)).join(' & ');
    const head = r.winners.length === 1 ? `${who} it is! 👑` : `It's a tie: ${who} 👑`;
    return `<h2>${head}</h2>
      <p>${r.agreed} of ${r.voters} voted with the crowd and scored a point.</p>`;
  }

  function recentHTML(S, names) {
    if (!S.recent.length) return '';
    return `<h3>Recent crowns</h3><ul class="recap">${S.recent
      .map(
        (h) =>
          `<li>Round ${h.round}, most likely to ${esc(h.prompt)}: <strong>${h.winners
            .map((id) => nm(names, id))
            .join(' & ')}</strong></li>`
      )
      .join('')}</ul>`;
  }

  const countLine = (S) =>
    S.here.length >= S.minPlayers
      ? `${S.here.length} players here`
      : `${S.here.length} here · need at least ${S.minPlayers} to play`;

  const lobbyHeader = (S, names) => `<h1>Most Likely To…</h1>
    <div class="bigcount">${countLine(S)}</div>
    ${S.notice ? `<p class="notice">${esc(S.notice)}</p>` : ''}
    <div>${S.here.length ? chips(S, names, S.here) : '<p class="waiting">Nobody here yet.</p>'}</div>`;

  // ---------------- TV / spectators ----------------
  function tvHTML(S, names) {
    if (S.phase === 'lobby') {
      return `${lobbyHeader(S, names)}
        <p class="waiting">${
          S.canStart
            ? 'Anyone can tap “Start game” on their phone.'
            : 'Use the ➕ Join button to show the code, and join on your phone.'
        } Friends can join or leave at any time.</p>
        ${recentHTML(S, names)}${scoreboard(S, names)}`;
    }
    if (S.phase === 'revealed') {
      return `${promptHTML(S)}${resultHTML(S, names)}${winnersLine(S, names)}
        <p class="waiting">Tap “Next round” on any phone to continue.</p>
        ${scoreboard(S, names)}`;
    }
    const cards = S.roster
      .map(
        (id) => `<div class="player${away(S, id)}"><h3>${nm(names, id)}</h3>
          <p>${S.votedBy[id] ? '✅ voted' : hereSet(S).has(id) ? '🤔 thinking…' : '💤 away'}</p>
          <p>${S.scores[id]} pts · ${S.crowns[id]} 👑</p></div>`
      )
      .join('');
    const waiting = S.here.filter((id) => !S.roster.includes(id));
    return `${promptHTML(S)}
      <p class="waiting">Vote on your phone! ${S.votedCount} of ${S.roster.length} have voted.</p>
      ${S.paused ? '<p class="paused">Waiting for players to come back…</p>' : ''}
      <div class="players">${cards}</div>
      ${waiting.length ? `<p class="progress">Joining next round:</p><div>${chips(S, names, waiting).replace(/class="chip"/g, 'class="chip wait"')}</div>` : ''}`;
  }

  // ---------------- A player's phone ----------------
  function phoneHTML(S, names, playerID) {
    if (S.phase === 'lobby') {
      return `${lobbyHeader(S, names)}
        <p><button id="start" ${S.canStart ? '' : 'disabled'}>Start game</button></p>
        <p class="progress">${
          S.canStart ? 'Anyone can start. Others can still join later.' : `Waiting for ${S.minPlayers - S.here.length} more player${S.minPlayers - S.here.length === 1 ? '' : 's'}…`
        }</p>
        ${scoreboard(S, names)}`;
    }

    if (S.phase === 'revealed') {
      let mine = 'You joined during this round, so you will play the next one.';
      if (S.inRound) {
        mine = 'You did not vote.';
        if (S.myVote !== null) {
          mine = S.result.winners.includes(S.myVote)
            ? `You voted for ${nm(names, S.myVote)}: with the crowd! +1 ✅`
            : `You voted for ${nm(names, S.myVote)}: not this time.`;
        }
      }
      return `${promptHTML(S)}${resultHTML(S, names)}${winnersLine(S, names)}
        <p>${mine}</p><button id="next">Next round</button>
        ${scoreboard(S, names)}`;
    }

    // voting
    if (!S.inRound) {
      return `${promptHTML(S)}
        <p class="waiting">A round is already under way. You will join in the next one!</p>
        <p class="progress">${S.votedCount} of ${S.roster.length} have voted.</p>`;
    }

    if (S.myVote !== null) {
      return `${promptHTML(S)}
        <p>You voted for <strong>${nm(names, S.myVote)}</strong>.</p>
        <p class="waiting">Waiting for the others (${S.votedCount} of ${S.roster.length} voted)…</p>
        ${S.paused ? '<p class="paused">Some players have gone quiet. Waiting for them to come back…</p>' : ''}
        ${
          S.canReveal
            ? '<button id="revealNow" class="secondary">Reveal now</button><p class="progress">(skips anyone who has not voted)</p>'
            : ''
        }`;
    }

    const others = S.roster.filter((id) => id !== playerID);
    return `${promptHTML(S)}
      <p>Tap who you think it is:</p>
      ${others
        .map((id) => {
          const gone = !hereSet(S).has(id);
          return `<button class="target${voteSel === id ? ' sel' : ''}" data-target="${id}" ${gone ? 'disabled' : ''}>${nm(names, id)}${gone ? ' 💤' : ''}</button>`;
        })
        .join('')}
      <p><button id="sendVote" ${voteSel === null ? 'disabled' : ''}>Vote</button></p>`;
  }

  // ---------------- Buttons ----------------
  function bind() {
    root.querySelectorAll('[data-target]').forEach((b) => {
      b.onclick = () => {
        voteSel = b.dataset.target;
        render(last);
      };
    });
    const sendVote = root.querySelector('#sendVote');
    if (sendVote) {
      sendVote.onclick = () => {
        if (voteSel === null) return;
        sendVote.disabled = true;
        send('vote', voteSel);
        voteSel = null;
        // If the server refuses it, the buttons come back
        setTimeout(() => sendVote.isConnected && render(last), 3000);
      };
    }
    const start = root.querySelector('#start');
    if (start) {
      start.onclick = () => {
        start.disabled = true;
        send('start');
        setTimeout(() => start.isConnected && render(last), 3000);
      };
    }
    const revealNow = root.querySelector('#revealNow');
    if (revealNow) {
      revealNow.onclick = () => {
        revealNow.disabled = true;
        send('revealNow');
      };
    }
    const next = root.querySelector('#next');
    if (next) {
      next.onclick = () => {
        next.disabled = true;
        send('next', last.state.G.round);
        setTimeout(() => next.isConnected && render(last), 3000);
      };
    }
  }

  // ---------------- Render ----------------
  function render(msg) {
    const firstOfKind = !last || lastView !== msg.view;
    last = msg;
    lastView = msg.view;
    const { view, playerID, names, state } = msg;
    const S = state.G;
    if (view === 'player') {
      if (S.round !== selRound) {
        selRound = S.round;
        voteSel = null;
      }
      if (S.myVote !== null) voteSel = null;
      root.innerHTML = phoneHTML(S, names, playerID);
      bind();
      if (firstOfKind) beat(); // say hello straight away, and again when coming back from the TV view
    } else {
      root.innerHTML = tvHTML(S, names);
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== parent || !e.data) return;
    if (e.data.type === 'state') {
      render(e.data);
    } else if (e.data.type === 'leaving') {
      // The player tapped Leave. Tell the game right away so nobody waits for them;
      // the platform takes them back to the catalog a moment later.
      if (isPlayerView()) send('goodbye');
      leaving = true; // no more "I'm here" while they are on their way out
      setTimeout(() => { leaving = false; }, 4000);
    }
  });
  parent.postMessage({ type: 'ready' }, '*');
})();