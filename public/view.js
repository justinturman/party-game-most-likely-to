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

  function scoreboard(S, names) {
    const ids = [...S.players].sort(
      (a, b) => S.scores[b] - S.scores[a] || S.crowns[b] - S.crowns[a]
    );
    return (
      '<div class="players">' +
      ids
        .map(
          (id) =>
            `<div class="player"><h3>${nm(names, id)}</h3><p>${S.scores[id]} pts</p><p>${S.crowns[id]} 👑</p></div>`
        )
        .join('') +
      '</div>'
    );
  }

  function promptHTML(S) {
    return `<p class="lead">Who is most likely to…</p>
      <h1 class="prompt">${esc(S.prompt)}?</h1>
      <p class="progress">Round ${S.round + 1} of ${S.total}</p>`;
  }

  function resultHTML(S, names) {
    const r = S.result;
    const max = Math.max(1, ...Object.values(r.counts));
    const ids = [...S.players].sort((a, b) => r.counts[b] - r.counts[a]);
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

  function finalHTML(S, names) {
    const best = Math.max(...Object.values(S.scores));
    const w = S.players.filter((id) => S.scores[id] === best);
    const title =
      w.length === 1
        ? `${nm(names, w[0])} read the room best! 🎉`
        : `It's a tie: ${w.map((id) => nm(names, id)).join(', ')}`;
    const recap = S.history
      .map(
        (h) =>
          `<li>Most likely to ${esc(h.prompt)}: <strong>${h.winners
            .map((id) => nm(names, id))
            .join(' & ')}</strong></li>`
      )
      .join('');
    return `<h1>${title}</h1>${scoreboard(S, names)}
      <h3>The crowd's picks</h3><ul class="recap">${recap}</ul>`;
  }

  // ---------------- TV / spectators ----------------
  function tvHTML(S, names) {
    if (S.phase === 'gameover') return finalHTML(S, names);
    if (S.phase === 'revealed') {
      return `${promptHTML(S)}${resultHTML(S, names)}${winnersLine(S, names)}
        <p class="waiting">Tap “Next round” on any phone to continue.</p>
        ${scoreboard(S, names)}`;
    }
    const cards = S.players
      .map(
        (id) => `<div class="player"><h3>${nm(names, id)}</h3>
          <p>${S.votedBy[id] ? '✅ voted' : '🤔 thinking…'}</p>
          <p>${S.scores[id]} pts · ${S.crowns[id]} 👑</p></div>`
      )
      .join('');
    return `${promptHTML(S)}
      <p class="waiting">Vote on your phone! ${S.votedCount} of ${S.players.length} have voted.</p>
      <div class="players">${cards}</div>`;
  }

  // ---------------- A player's phone ----------------
  function phoneHTML(S, names, playerID) {
    if (S.phase === 'gameover') return finalHTML(S, names);

    if (S.phase === 'revealed') {
      let mine = 'You did not vote.';
      if (S.myVote !== null) {
        mine = S.result.winners.includes(S.myVote)
          ? `You voted for ${nm(names, S.myVote)}: with the crowd! +1 ✅`
          : `You voted for ${nm(names, S.myVote)}: not this time.`;
      }
      const label = S.round + 1 >= S.total ? 'See final scores' : 'Next round';
      return `${promptHTML(S)}${resultHTML(S, names)}${winnersLine(S, names)}
        <p>${mine}</p><button id="next">${label}</button>`;
    }

    if (S.myVote !== null) {
      return `${promptHTML(S)}
        <p>You voted for <strong>${nm(names, S.myVote)}</strong>.</p>
        <p class="waiting">Waiting for the others (${S.votedCount} of ${S.players.length} voted)…</p>
        ${
          S.canReveal
            ? '<button id="revealNow" class="secondary">Reveal now</button><p class="progress">(skips anyone who has not voted)</p>'
            : ''
        }`;
    }

    const others = S.players.filter((id) => id !== playerID);
    return `${promptHTML(S)}
      <p>Tap who you think it is:</p>
      ${others
        .map(
          (id) =>
            `<button class="target${voteSel === id ? ' sel' : ''}" data-target="${id}">${nm(names, id)}</button>`
        )
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
    last = msg;
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
    } else {
      root.innerHTML = tvHTML(S, names);
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source === parent && e.data && e.data.type === 'state') render(e.data);
  });
  parent.postMessage({ type: 'ready' }, '*');
})();