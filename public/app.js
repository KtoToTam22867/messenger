const socket = io();

// ========== STATE ==========
let me = null;
let curCh = null;
let curSrv = null;
let allCh = [];
let typMap = {};
let membersShown = true;

// Voice
let voiceCh = null;
let localStream = null;
let screenStream = null;
let peers = {};
let isMuted = false;
let isDeaf = false;
let isVid = false;
let isScr = false;
let pendingAv = null;

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
const $ = (id) => document.getElementById(id);

// ========================================
// ========== SOUND ENGINE ================
// ========================================
let _actx = null;
function actx() {
  try {
    if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
    if (_actx.state === 'suspended') _actx.resume();
    return _actx;
  } catch (e) {
    return null;
  }
}

function playTones(notes) {
  try {
    const ctx = actx();
    if (!ctx) return;
    const now = ctx.currentTime;
    notes.forEach(([freq, delay, dur, vol, type]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.1, now + (delay || 0));
      g.gain.exponentialRampToValueAtTime(0.001, now + (delay || 0) + (dur || 0.15));
      o.start(now + (delay || 0));
      o.stop(now + (delay || 0) + (dur || 0.15));
    });
  } catch (e) { /* ignore audio errors */ }
}

const SFX = {
  login:       () => playTones([[523,.0,.15,.12],[659,.1,.15,.12],[784,.2,.15,.12]]),
  error:       () => playTones([[200,.0,.12,.08,'square'],[150,.1,.12,.08,'square']]),
  msgSend:     () => playTones([[600,.0,.05,.06],[1200,.03,.05,.06]]),
  msgRecv:     () => playTones([[880,.0,.12,.08],[1100,.12,.12,.08]]),
  chSwitch:    () => playTones([[700,.0,.04,.04]]),
  voiceJoin:   () => playTones([[392,.0,.15,.12],[523,.08,.15,.12],[659,.16,.15,.12]]),
  voiceLeave:  () => playTones([[659,.0,.15,.12],[523,.1,.15,.12],[392,.2,.15,.12]]),
  userJoinVC:  () => playTones([[440,.0,.1,.1],[554,.06,.1,.1]]),
  userLeaveVC: () => playTones([[554,.0,.1,.1],[440,.06,.1,.1]]),
  mute:        () => playTones([[400,.0,.06,.05]]),
  unmute:      () => playTones([[500,.0,.06,.05]]),
  screenOn:    () => playTones([[523,.0,.1,.08],[659,.06,.1,.08],[784,.12,.1,.08],[1047,.18,.1,.08]]),
  screenOff:   () => playTones([[784,.0,.1,.06],[659,.08,.1,.06],[523,.16,.1,.06]]),
  userOn:      () => playTones([[600,.0,.1,.06,'triangle'],[900,.1,.1,.06,'triangle']]),
  userOff:     () => playTones([[900,.0,.1,.06,'triangle'],[600,.1,.1,.06,'triangle']]),
  notify:      () => playTones([[660,.0,.1,.07],[880,.15,.1,.07]]),
};

// ========== TOAST ==========
function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast t-' + (type || 'info');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 3200);
}

// ========================================
// ========== LOGIN =======================
// ========================================
let loginMode = 'guest';

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    loginMode = t.dataset.tab;
    $('field-pass').classList.toggle('hidden', loginMode === 'guest');
    $('submit-btn').textContent =
      loginMode === 'guest' ? 'Войти как гость' :
      loginMode === 'register' ? 'Зарегистрироваться' : 'Войти';
  });
});

// Login avatar upload
$('login-av-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('avatar', file);
  try {
    const res = await fetch('/upload-avatar', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.url) {
      pendingAv = data.url;
      $('login-av-img').src = data.url;
      $('login-av-img').classList.remove('hidden');
      $('login-av-letter').classList.add('hidden');
    }
  } catch (err) { console.error(err); }
});

// Form submit
$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const username = $('inp-user').value.trim();
  const password = $('inp-pass').value;
  $('error-text').textContent = '';

  if (!username) {
    $('error-text').textContent = 'Введите имя';
    SFX.error();
    return;
  }

  if (loginMode === 'guest') {
    console.log('Sending guest-login...');
    socket.emit('guest-login', { username, avatarUrl: pendingAv }, handleLoginResult);
  } else if (loginMode === 'register') {
    if (!password) {
      $('error-text').textContent = 'Введите пароль';
      SFX.error();
      return;
    }
    console.log('Sending register...');
    socket.emit('register', { username, password, avatarUrl: pendingAv }, (r) => {
      console.log('Register result:', r);
      if (r.ok) {
        toast('Аккаунт создан! 🎉', 'ok');
        SFX.notify();
        // Now login
        socket.emit('login', { username, password }, handleLoginResult);
      } else {
        $('error-text').textContent = r.err || 'Ошибка';
        SFX.error();
      }
    });
  } else {
    if (!password) {
      $('error-text').textContent = 'Введите пароль';
      SFX.error();
      return;
    }
    console.log('Sending login...');
    socket.emit('login', { username, password }, handleLoginResult);
  }
});

function handleLoginResult(r) {
  console.log('Login result:', r);
  if (!r || !r.ok) {
    $('error-text').textContent = (r && r.err) ? r.err : 'Ошибка подключения';
    SFX.error();
    return;
  }

  // Save user
  me = r.user;
  allCh = r.channels || [];

  // Switch screens
  $('login-screen').classList.add('hidden');
  $('app').classList.remove('hidden');

  // Setup UI
  setMyAvatar();
  $('my-name').textContent = me.username;
  $('srv-name').textContent = r.server ? r.server.name : 'Сервер';
  curSrv = r.server ? r.server.id : 'srv-1';

  // Render channels
  renderChannels(allCh);

  // Render members
  if (r.members) updateMembers(r.members);

  // Restore voice state
  if (r.voiceState) {
    Object.entries(r.voiceState).forEach(([chId, mems]) => updateVoiceSidebar(chId, mems));
  }

  // Select first text channel
  const firstText = allCh.find(c => c.type === 'text');
  if (firstText) selectChannel(firstText.id);

  // Play login sound
  SFX.login();
  toast(`Привет, ${me.username}! 👋`, 'ok');
}

function setMyAvatar() {
  const el = $('my-av');
  if (me.avatarUrl) {
    el.innerHTML = `<img src="${me.avatarUrl}" alt="">`;
  } else {
    el.style.backgroundColor = me.color;
    el.textContent = me.username[0].toUpperCase();
  }
}

// ========================================
// ========== RENDER ======================
// ========================================
function renderChannels(list) {
  $('text-ch').innerHTML = '';
  $('voice-ch').innerHTML = '';

  list.forEach(ch => {
    const el = document.createElement('div');
    el.className = 'ch-item';
    el.dataset.chId = ch.id;

    if (ch.type === 'voice') {
      el.innerHTML = `<span class="ch-ic">🔊</span><span>${esc(ch.name)}</span>`;
      el.addEventListener('click', () => joinVoice(ch.id, ch.name));
      $('voice-ch').appendChild(el);

      // Voice users container
      const vu = document.createElement('div');
      vu.className = 'vc-users';
      vu.id = 'vu-' + ch.id;
      $('voice-ch').appendChild(vu);
    } else {
      el.innerHTML = `<span class="ch-ic">#</span><span>${esc(ch.name)}</span>`;
      el.addEventListener('click', () => selectChannel(ch.id));
      $('text-ch').appendChild(el);
    }
  });
}

function selectChannel(id) {
  if (curCh === id) return;
  curCh = id;
  const ch = allCh.find(c => c.id === id);
  if (!ch) return;

  // Highlight
  document.querySelectorAll('.ch-item').forEach(e => e.classList.remove('active'));
  const el = document.querySelector(`[data-ch-id="${id}"]`);
  if (el) el.classList.add('active');

  // Header
  $('top-name').textContent = ch.name;
  $('w-ch-name').textContent = ch.name;
  $('msg-inp').placeholder = `Написать в #${ch.name}`;

  // Show chat
  $('chat-col').classList.remove('hidden');
  if (!voiceCh) $('voice-col').classList.add('hidden');

  // Load messages
  $('msg-list').innerHTML = '';
  socket.emit('get-messages', { channelId: id }, (msgs) => {
    if (msgs && msgs.length) {
      msgs.forEach(m => appendMessage(m, false));
    }
    scrollBottom();
  });

  SFX.chSwitch();
}

// ========================================
// ========== MESSAGES ====================
// ========================================
function appendMessage(msg, doScroll) {
  const container = $('msg-list');
  const last = container.lastElementChild;
  const isFirst = !last ||
    last.dataset.aid !== msg.author.id ||
    (msg.timestamp - parseInt(last.dataset.ts || '0')) > 300000;

  const el = document.createElement('div');
  el.className = 'message' + (isFirst ? ' first-msg' : '');
  el.dataset.mid = msg.id;
  el.dataset.aid = msg.author.id;
  el.dataset.ts = msg.timestamp;

  const t = new Date(msg.timestamp);
  const time = t.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const date = t.toLocaleDateString('ru');
  const text = formatText(msg.content);
  const imgHTML = msg.imageUrl
    ? `<img class="msg-img" src="${msg.imageUrl}" onclick="window.open('${msg.imageUrl}')">`
    : '';
  const reactHTML = renderReactions(msg);
  const isOwn = msg.author.id === me?.id;
  const ownBtns = isOwn
    ? `<button class="ma-btn" data-act="edit" data-mid="${msg.id}" data-cid="${msg.channelId}">✏️</button>
       <button class="ma-btn" data-act="del" data-mid="${msg.id}" data-cid="${msg.channelId}">🗑️</button>`
    : '';

  if (isFirst) {
    el.innerHTML = `
      ${avatarHTML(msg.author, 'msg-av')}
      <div class="msg-body">
        <div class="msg-head">
          <span class="msg-author" style="color:${msg.author.color}">${esc(msg.author.username)}</span>
          <span class="msg-time">${date} ${time}</span>
        </div>
        <div class="msg-text">${text}</div>
        ${imgHTML}
        ${msg.edited ? '<span class="msg-edited">(ред.)</span>' : ''}
        <div class="msg-reactions">${reactHTML}</div>
      </div>
      <div class="msg-actions">
        <button class="ma-btn" data-act="react" data-mid="${msg.id}" data-cid="${msg.channelId}">😊</button>
        ${ownBtns}
      </div>`;
  } else {
    el.innerHTML = `
      <span class="inline-ts">${time}</span>
      <div class="msg-av-ph"></div>
      <div class="msg-body">
        <div class="msg-text">${text}</div>
        ${imgHTML}
        ${msg.edited ? '<span class="msg-edited">(ред.)</span>' : ''}
        <div class="msg-reactions">${reactHTML}</div>
      </div>
      <div class="msg-actions">
        <button class="ma-btn" data-act="react" data-mid="${msg.id}" data-cid="${msg.channelId}">😊</button>
        ${ownBtns}
      </div>`;
  }

  el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); showCtx(ev, msg); });
  container.appendChild(el);
  if (doScroll !== false) scrollBottom();
}

function avatarHTML(user, cls) {
  if (user.avatarUrl) {
    return `<div class="${cls}" style="background:${user.color}"><img src="${user.avatarUrl}" alt=""></div>`;
  }
  return `<div class="${cls}" style="background:${user.color}">${(user.username || '?')[0].toUpperCase()}</div>`;
}

function renderReactions(msg) {
  if (!msg.reactions || !Object.keys(msg.reactions).length) return '';
  return Object.entries(msg.reactions).map(([emoji, ids]) => {
    const isMine = ids.includes(me?.id) ? 'mine' : '';
    return `<span class="react-badge ${isMine}" onclick="window._togReact('${msg.id}','${msg.channelId}','${emoji}')">${emoji} <span class="react-cnt">${ids.length}</span></span>`;
  }).join('');
}

window._togReact = (mid, cid, emoji) => {
  socket.emit('add-reaction', { messageId: mid, channelId: cid, emoji });
};

// ========== INPUT ==========
$('msg-inp').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

$('msg-inp').addEventListener('input', () => {
  const el = $('msg-inp');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  if (curCh) socket.emit('typing', { channelId: curCh });
});

function sendMessage() {
  const text = $('msg-inp').value.trim();
  if (!text || !curCh) return;
  socket.emit('send-message', { channelId: curCh, content: text });
  $('msg-inp').value = '';
  $('msg-inp').style.height = 'auto';
  SFX.msgSend();
}

// File upload
$('file-inp').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/upload-file', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.url) {
      socket.emit('send-message', { channelId: curCh, content: '', imageUrl: data.url });
      SFX.msgSend();
    }
  } catch (err) { console.error(err); }
  e.target.value = '';
});

// ========== MSG ACTIONS ==========
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.ma-btn');
  if (!btn) return;
  const { act, mid, cid } = btn.dataset;
  if (act === 'react') {
    const emojis = ['👍','❤️','😂','😮','😢','🔥','🎉','💯','👀','🤔'];
    socket.emit('add-reaction', { messageId: mid, channelId: cid, emoji: emojis[Math.floor(Math.random() * emojis.length)] });
  } else if (act === 'edit') {
    editMessage(mid, cid);
  } else if (act === 'del') {
    socket.emit('delete-message', { messageId: mid, channelId: cid });
  }
});

function editMessage(mid, cid) {
  const el = document.querySelector(`[data-mid="${mid}"] .msg-text`);
  if (!el) return;
  const old = el.textContent;
  const inp = document.createElement('textarea');
  inp.value = old;
  inp.style.cssText = 'width:100%;padding:8px;background:var(--bg3);border:1px solid var(--brand);border-radius:4px;color:var(--txt);font-size:15px;font-family:inherit;resize:none;outline:0';
  el.replaceWith(inp);
  inp.focus();

  function save() {
    const v = inp.value.trim();
    if (v && v !== old) socket.emit('edit-message', { messageId: mid, channelId: cid, content: v });
    const s = document.createElement('div');
    s.className = 'msg-text';
    s.innerHTML = formatText(v || old);
    inp.replaceWith(s);
  }

  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    if (e.key === 'Escape') {
      const s = document.createElement('div');
      s.className = 'msg-text';
      s.innerHTML = formatText(old);
      inp.replaceWith(s);
    }
  });
  inp.addEventListener('blur', save);
}

// ========== CONTEXT MENU ==========
function showCtx(ev, msg) {
  const c = $('ctx');
  c.style.left = ev.clientX + 'px';
  c.style.top = ev.clientY + 'px';
  c.classList.remove('hidden');
  c.dataset.mid = msg.id;
  c.dataset.cid = msg.channelId;
  c.dataset.content = msg.content;
  const isOwn = msg.author.id === me?.id;
  c.querySelectorAll('.own-only').forEach(el => { el.style.display = isOwn ? 'flex' : 'none'; });
}

document.addEventListener('click', () => $('ctx').classList.add('hidden'));

$('ctx').addEventListener('click', (e) => {
  const item = e.target.closest('.ctx-item');
  if (!item) return;
  const { mid, cid, content } = $('ctx').dataset;
  const a = item.dataset.a;
  if (a === 'react') {
    const emojis = ['👍','❤️','😂','😮','😢','🔥','🎉','💯'];
    socket.emit('add-reaction', { messageId: mid, channelId: cid, emoji: emojis[Math.floor(Math.random() * emojis.length)] });
  } else if (a === 'copy') {
    navigator.clipboard.writeText(content);
    toast('Скопировано!', 'info');
  } else if (a === 'edit') editMessage(mid, cid);
  else if (a === 'delete') socket.emit('delete-message', { messageId: mid, channelId: cid });
  $('ctx').classList.add('hidden');
});

// ========== EMOJI ==========
const EMOJIS = '😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬😌😔😪😴😷🤒🤕🤢🤮🥴😵🤯🤠🥳😎🤓🧐😕😟🙁😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠️💩🤡👹👺👻👽👾🤖❤️🧡💛💚💙💜🖤🤍🤎💔💕💞💓💗💖💘💝💟👍👎👊✊🤛🤜🤝👏🙌👐🤲🙏💪🔥⭐🌟✨💥💫🎉🎊🏆🥇💯🎵🎶🎸🎮🎯🚀💻📱💡🔑'.match(/./gu);

(function initEmoji() {
  const g = $('emo-grid');
  EMOJIS.forEach(em => {
    const s = document.createElement('span');
    s.textContent = em;
    s.addEventListener('click', () => {
      $('msg-inp').value += em;
      $('msg-inp').focus();
      $('emo-popup').classList.add('hidden');
    });
    g.appendChild(s);
  });
})();

$('emoji-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('emo-popup').classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!$('emo-popup').contains(e.target) && e.target !== $('emoji-btn'))
    $('emo-popup').classList.add('hidden');
});

// ========== MEMBERS ==========
function updateMembers(list) {
  $('online-cnt').textContent = list.length;
  $('mem-list').innerHTML = '';
  list.forEach(m => {
    const el = document.createElement('div');
    el.className = 'mem-item';
    el.innerHTML = `
      <div class="mem-av" style="background:${m.color}">
        ${m.avatarUrl ? `<img src="${m.avatarUrl}">` : m.username[0].toUpperCase()}
        <div class="mem-dot ${m.status === 'online' ? 'online' : 'offline'}"></div>
      </div>
      <span class="mem-name">${esc(m.username)}</span>`;
    $('mem-list').appendChild(el);
  });
}

$('btn-members').addEventListener('click', () => {
  membersShown = !membersShown;
  $('members-col').style.display = membersShown ? '' : 'none';
  $('btn-members').classList.toggle('active-btn', membersShown);
});

// ========== CHANNEL CREATION ==========
document.querySelectorAll('.add-ch-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    $('modal-ch').classList.remove('hidden');
    const t = btn.dataset.type;
    document.querySelectorAll('.type-card').forEach(c => c.classList.toggle('sel', c.dataset.t === t));
  });
});

document.querySelectorAll('.type-card').forEach(c => {
  c.addEventListener('click', () => {
    document.querySelectorAll('.type-card').forEach(x => x.classList.remove('sel'));
    c.classList.add('sel');
  });
});

$('ch-cancel').addEventListener('click', () => $('modal-ch').classList.add('hidden'));
$('modal-ch').querySelector('.modal-bg').addEventListener('click', () => $('modal-ch').classList.add('hidden'));

$('ch-create').addEventListener('click', () => {
  const name = $('new-ch-inp').value.trim();
  const type = document.querySelector('.type-card.sel')?.dataset.t || 'text';
  if (!name) return;
  socket.emit('create-channel', {
    name: name.toLowerCase().replace(/\s+/g, '-'),
    type,
    serverId: curSrv
  }, (r) => {
    if (r && r.ok) {
      $('modal-ch').classList.add('hidden');
      $('new-ch-inp').value = '';
      toast('Канал создан!', 'ok');
      SFX.notify();
    }
  });
});

// ========== SETTINGS ==========
let cfgNewAv = null;

$('btn-cfg').addEventListener('click', () => {
  $('modal-cfg').classList.remove('hidden');
  if (me.avatarUrl) {
    $('cfg-av-img').src = me.avatarUrl;
    $('cfg-av-img').classList.remove('hidden');
    $('cfg-av-letter').classList.add('hidden');
  } else {
    $('cfg-av-letter').textContent = me.username[0].toUpperCase();
    $('cfg-av-letter').classList.remove('hidden');
    $('cfg-av-img').classList.add('hidden');
  }
  $('cfg-av').style.background = me.color;
  cfgNewAv = null;
});

$('cfg-av-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('avatar', file);
  try {
    const res = await fetch('/upload-avatar', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.url) {
      cfgNewAv = data.url;
      $('cfg-av-img').src = data.url;
      $('cfg-av-img').classList.remove('hidden');
      $('cfg-av-letter').classList.add('hidden');
    }
  } catch (err) { console.error(err); }
});

$('cfg-cancel').addEventListener('click', () => $('modal-cfg').classList.add('hidden'));
$('modal-cfg').querySelector('.modal-bg').addEventListener('click', () => $('modal-cfg').classList.add('hidden'));

$('cfg-save').addEventListener('click', () => {
  if (cfgNewAv) {
    me.avatarUrl = cfgNewAv;
    socket.emit('update-avatar', { avatarUrl: cfgNewAv });
    setMyAvatar();
    toast('Аватар обновлён!', 'ok');
    SFX.notify();
  }
  $('modal-cfg').classList.add('hidden');
});

// ========================================
// ========== VOICE =======================
// ========================================
async function joinVoice(chId, chName) {
  if (voiceCh === chId) return;
  if (voiceCh) leaveVoice();

  voiceCh = chId;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    console.warn('No mic:', e);
    localStream = new MediaStream();
  }

  socket.emit('join-voice', { channelId: chId });

  $('vc-bar').classList.remove('hidden');
  $('vcb-name').textContent = chName;
  $('va-ch-name').textContent = chName;
  $('voice-col').classList.remove('hidden');
  $('chat-col').classList.add('hidden');

  isMuted = false;
  isVid = false;
  isScr = false;
  updateVoiceBtns();
  renderVoiceGrid();

  SFX.voiceJoin();
  toast(`Подключён к «${chName}»`, 'ok');
}

function leaveVoice() {
  if (!voiceCh) return;

  SFX.voiceLeave();
  toast('Отключён от голосового', 'info');

  socket.emit('leave-voice', { channelId: voiceCh });

  // Close all peers
  Object.values(peers).forEach(p => { try { p.pc.close(); } catch (e) {} });
  peers = {};

  // Stop streams
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }

  // Remove audio elements
  document.querySelectorAll('audio[id^="au-"]').forEach(a => a.remove());

  voiceCh = null;
  $('vc-bar').classList.add('hidden');
  $('voice-col').classList.add('hidden');
  $('va-grid').innerHTML = '';

  if (curCh) $('chat-col').classList.remove('hidden');
}

async function createPeer(remoteSid, initiator, remoteUser) {
  const pc = new RTCPeerConnection(ICE);
  peers[remoteSid] = { pc, user: remoteUser, streams: {} };

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }
  if (screenStream) {
    screenStream.getTracks().forEach(t => pc.addTrack(t, screenStream));
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('webrtc-ice-candidate', { to: remoteSid, candidate: e.candidate });
  };

  pc.ontrack = (e) => {
    const stream = e.streams[0];
    if (!stream) return;
    const p = peers[remoteSid];
    if (!p) return;

    p.streams[stream.id] = stream;

    // Audio playback
    let au = document.getElementById('au-' + remoteSid);
    if (!au) {
      au = document.createElement('audio');
      au.id = 'au-' + remoteSid;
      au.autoplay = true;
      document.body.appendChild(au);
    }
    au.srcObject = stream;
    if (isDeaf) au.muted = true;

    renderVoiceGrid();
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === 'failed' || state === 'disconnected' || state === 'closed') {
      try { pc.close(); } catch (e) {}
      delete peers[remoteSid];
      renderVoiceGrid();
    }
  };

  if (initiator) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', { to: remoteSid, offer, channelId: voiceCh });
    } catch (e) { console.error('createOffer error:', e); }
  }

  return pc;
}

async function renegotiate(sid, pc) {
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-renegotiate-offer', { to: sid, offer });
  } catch (e) { console.error('renegotiate error:', e); }
}

// Voice controls
$('va-mic').addEventListener('click', toggleMic);
$('va-cam').addEventListener('click', toggleCam);
$('va-scr').addEventListener('click', toggleScreen);
$('va-hang').addEventListener('click', leaveVoice);
$('vcb-hang').addEventListener('click', leaveVoice);
$('btn-mic').addEventListener('click', toggleMic);
$('btn-deaf').addEventListener('click', toggleDeaf);

function toggleMic() {
  isMuted = !isMuted;
  if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  if (voiceCh) socket.emit('toggle-mute', { channelId: voiceCh, muted: isMuted });
  isMuted ? SFX.mute() : SFX.unmute();
  updateVoiceBtns();
}

function toggleDeaf() {
  isDeaf = !isDeaf;
  document.querySelectorAll('audio[id^="au-"]').forEach(a => { a.muted = isDeaf; });
  $('btn-deaf').classList.toggle('muted', isDeaf);
  $('btn-deaf').textContent = isDeaf ? '🔇' : '🔊';
  isDeaf ? SFX.mute() : SFX.unmute();
}

async function toggleCam() {
  isVid = !isVid;

  if (isVid) {
    try {
      const vs = await navigator.mediaDevices.getUserMedia({ video: true });
      const vt = vs.getVideoTracks()[0];
      if (localStream) localStream.addTrack(vt);

      Object.entries(peers).forEach(([sid, p]) => {
        p.pc.addTrack(vt, localStream);
        renegotiate(sid, p.pc);
      });

      if (voiceCh) socket.emit('toggle-video', { channelId: voiceCh, videoOn: true });
      SFX.notify();
    } catch (e) {
      console.error('Camera error:', e);
      isVid = false;
      SFX.error();
    }
  } else {
    if (localStream) {
      localStream.getVideoTracks().forEach(t => {
        t.stop();
        localStream.removeTrack(t);
        Object.entries(peers).forEach(([sid, p]) => {
          const sender = p.pc.getSenders().find(s => s.track === t);
          if (sender) { try { p.pc.removeTrack(sender); } catch (e) {} }
          renegotiate(sid, p.pc);
        });
      });
    }
    if (voiceCh) socket.emit('toggle-video', { channelId: voiceCh, videoOn: false });
  }

  updateVoiceBtns();
  renderVoiceGrid();
}

async function toggleScreen() {
  if (!isScr) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: true
      });

      screenStream.getTracks().forEach(t => {
        Object.entries(peers).forEach(([sid, p]) => {
          p.pc.addTrack(t, screenStream);
          renegotiate(sid, p.pc);
        });
      });

      isScr = true;
      socket.emit('screen-share-started', { channelId: voiceCh });
      SFX.screenOn();
      toast('Демонстрация экрана запущена', 'ok');

      // Handle browser stop button
      screenStream.getVideoTracks()[0].onended = () => stopScreen();
    } catch (e) {
      console.error('Screen share error:', e);
      SFX.error();
    }
  } else {
    stopScreen();
  }

  updateVoiceBtns();
  renderVoiceGrid();
}

function stopScreen() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => {
      t.stop();
      Object.entries(peers).forEach(([sid, p]) => {
        const sender = p.pc.getSenders().find(s => s.track === t);
        if (sender) { try { p.pc.removeTrack(sender); } catch (e) {} }
        renegotiate(sid, p.pc);
      });
    });
    screenStream = null;
  }
  isScr = false;
  if (voiceCh) socket.emit('screen-share-stopped', { channelId: voiceCh });
  SFX.screenOff();
  toast('Демонстрация остановлена', 'info');
  updateVoiceBtns();
  renderVoiceGrid();
}

function updateVoiceBtns() {
  $('va-mic').textContent = isMuted ? '🔇' : '🎤';
  $('va-mic').classList.toggle('muted', isMuted);
  $('va-cam').textContent = isVid ? '📹' : '📷';
  $('va-cam').classList.toggle('on', isVid);
  $('va-scr').classList.toggle('on', isScr);
  $('btn-mic').classList.toggle('muted', isMuted);
  $('btn-mic').textContent = isMuted ? '🔇' : '🎤';
}

// ========== VOICE GRID ==========
function renderVoiceGrid() {
  const grid = $('va-grid');
  grid.innerHTML = '';
  if (!me) return;

  // My screen share
  if (isScr && screenStream) {
    const card = document.createElement('div');
    card.className = 'va-card has-screen';
    const vid = document.createElement('video');
    vid.autoplay = true; vid.playsInline = true; vid.muted = true;
    vid.srcObject = screenStream;
    card.appendChild(vid);
    const label = document.createElement('div');
    label.className = 'va-label';
    label.textContent = `🖥️ ${me.username} — Экран`;
    card.appendChild(label);
    grid.appendChild(card);
  }

  // My camera
  if (isVid && localStream && localStream.getVideoTracks().length) {
    const card = document.createElement('div');
    card.className = 'va-card has-vid';
    const vid = document.createElement('video');
    vid.autoplay = true; vid.playsInline = true; vid.muted = true;
    vid.srcObject = new MediaStream(localStream.getVideoTracks());
    card.appendChild(vid);
    const label = document.createElement('div');
    label.className = 'va-label';
    label.textContent = `${me.username} — Камера`;
    card.appendChild(label);
    grid.appendChild(card);
  }

  // My avatar (when no cam)
  if (!isVid) {
    const card = document.createElement('div');
    card.className = 'va-card';
    card.innerHTML = `
      <div class="va-av-lg" style="background:${me.color}">
        ${me.avatarUrl ? `<img src="${me.avatarUrl}">` : me.username[0].toUpperCase()}
      </div>
      <div class="va-nm">${esc(me.username)}</div>
      <div class="va-icons">${isMuted ? '🔇' : '🎤'}</div>`;
    grid.appendChild(card);
  }

  // Remote peers
  Object.entries(peers).forEach(([sid, p]) => {
    const u = p.user || { username: sid.slice(0, 6), color: '#666', avatarUrl: null };
    const streams = Object.values(p.streams);
    let hasVideoCard = false;

    streams.forEach(stream => {
      const vtracks = stream.getVideoTracks();
      vtracks.forEach(vt => {
        const settings = vt.getSettings();
        const isScreenTrack = (settings.width && settings.width >= 1000) ||
          vt.label.toLowerCase().includes('screen') ||
          vt.label.toLowerCase().includes('monitor') ||
          vt.label.toLowerCase().includes('window') ||
          vt.label.toLowerCase().includes('display');

        if (isScreenTrack) {
          const card = document.createElement('div');
          card.className = 'va-card has-screen';
          const vid = document.createElement('video');
          vid.autoplay = true; vid.playsInline = true;
          vid.srcObject = stream;
          card.appendChild(vid);
          const label = document.createElement('div');
          label.className = 'va-label';
          label.textContent = `🖥️ ${u.username} — Экран`;
          card.appendChild(label);
          grid.appendChild(card);
        } else {
          hasVideoCard = true;
          const card = document.createElement('div');
          card.className = 'va-card has-vid';
          const vid = document.createElement('video');
          vid.autoplay = true; vid.playsInline = true;
          vid.srcObject = stream;
          card.appendChild(vid);
          const label = document.createElement('div');
          label.className = 'va-label';
          label.textContent = u.username;
          card.appendChild(label);
          grid.appendChild(card);
        }
      });
    });

    // Avatar card if no camera video
    if (!hasVideoCard) {
      const card = document.createElement('div');
      card.className = 'va-card';
      card.innerHTML = `
        <div class="va-av-lg" style="background:${u.color}">
          ${u.avatarUrl ? `<img src="${u.avatarUrl}">` : (u.username || '?')[0].toUpperCase()}
        </div>
        <div class="va-nm">${esc(u.username)}</div>
        <div class="va-icons">🎤</div>`;
      grid.appendChild(card);
    }
  });
}

// Voice sidebar users
function updateVoiceSidebar(chId, mems) {
  const el = document.getElementById('vu-' + chId);
  if (!el) return;
  el.innerHTML = '';
  mems.forEach(m => {
    const d = document.createElement('div');
    d.className = 'vc-user';
    d.innerHTML = `
      <div class="vc-user-av" style="background:${m.color}">
        ${m.avatarUrl ? `<img src="${m.avatarUrl}">` : (m.username || '?')[0].toUpperCase()}
      </div>
      <span>${esc(m.username)}${m.muted ? ' 🔇' : ''}</span>`;
    el.appendChild(d);
  });
}

// ========================================
// ========== SOCKET EVENTS ===============
// ========================================
socket.on('new-message', (msg) => {
  if (msg.channelId === curCh) {
    appendMessage(msg, true);
    if (msg.author.id !== me?.id) SFX.msgRecv();
  }
});

socket.on('message-edited', ({ messageId, channelId, content }) => {
  if (channelId !== curCh) return;
  const el = document.querySelector(`[data-mid="${messageId}"] .msg-text`);
  if (el) el.innerHTML = formatText(content);
  const msgEl = document.querySelector(`[data-mid="${messageId}"]`);
  if (msgEl && !msgEl.querySelector('.msg-edited')) {
    const ed = document.createElement('span');
    ed.className = 'msg-edited';
    ed.textContent = '(ред.)';
    msgEl.querySelector('.msg-body')?.appendChild(ed);
  }
});

socket.on('message-deleted', ({ messageId }) => {
  const el = document.querySelector(`[data-mid="${messageId}"]`);
  if (el) el.remove();
});

socket.on('reaction-updated', ({ messageId, channelId, reactions }) => {
  if (channelId !== curCh) return;
  const el = document.querySelector(`[data-mid="${messageId}"] .msg-reactions`);
  if (el) el.innerHTML = renderReactions({ id: messageId, channelId, reactions });
});

socket.on('members-update', updateMembers);

socket.on('user-joined', (u) => {
  if (u.id !== me?.id) {
    SFX.userOn();
    toast(`${u.username} присоединился`, 'info');
  }
});

socket.on('user-left', (u) => {
  if (u.id !== me?.id) {
    SFX.userOff();
  }
});

socket.on('user-typing', ({ channelId, username }) => {
  if (channelId !== curCh) return;
  typMap[username] = Date.now();
  showTyping();
  setTimeout(() => {
    if (Date.now() - typMap[username] > 3000) {
      delete typMap[username];
      showTyping();
    }
  }, 3500);
});

socket.on('channel-created', (ch) => {
  allCh.push(ch);
  renderChannels(allCh);
  // Re-highlight current channel
  if (curCh) {
    const el = document.querySelector(`[data-ch-id="${curCh}"]`);
    if (el) el.classList.add('active');
  }
});

// --- Voice socket events ---
socket.on('voice-peers', async ({ peers: existingPeers }) => {
  for (const p of existingPeers) {
    await createPeer(p.socketId, true, p.user);
  }
  renderVoiceGrid();
});

socket.on('voice-user-joined', async ({ socketId: sid, user: u }) => {
  if (!peers[sid] && voiceCh) {
    await createPeer(sid, false, u);
    SFX.userJoinVC();
    toast(`${u.username} подключился к голосовому`, 'info');
    renderVoiceGrid();
  }
});

socket.on('voice-user-left', ({ socketId: sid }) => {
  if (peers[sid]) {
    const u = peers[sid].user;
    try { peers[sid].pc.close(); } catch (e) {}
    delete peers[sid];
    const au = document.getElementById('au-' + sid);
    if (au) au.remove();
    SFX.userLeaveVC();
    if (u) toast(`${u.username} отключился`, 'info');
    renderVoiceGrid();
  }
});

socket.on('webrtc-offer', async ({ from, offer }) => {
  let p = peers[from];
  if (!p) {
    await createPeer(from, false, null);
    p = peers[from];
  }
  try {
    await p.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await p.pc.createAnswer();
    await p.pc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { to: from, answer, channelId: voiceCh });
  } catch (e) { console.error('webrtc-offer error:', e); }
});

socket.on('webrtc-answer', async ({ from, answer }) => {
  const p = peers[from];
  if (p) {
    try { await p.pc.setRemoteDescription(new RTCSessionDescription(answer)); } catch (e) { console.error(e); }
  }
});

socket.on('webrtc-ice-candidate', async ({ from, candidate }) => {
  const p = peers[from];
  if (p) {
    try { await p.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
  }
});

socket.on('webrtc-renegotiate-offer', async ({ from, offer }) => {
  const p = peers[from];
  if (!p) return;
  try {
    await p.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await p.pc.createAnswer();
    await p.pc.setLocalDescription(answer);
    socket.emit('webrtc-renegotiate-answer', { to: from, answer });
    renderVoiceGrid();
  } catch (e) { console.error('renegotiate-offer error:', e); }
});

socket.on('webrtc-renegotiate-answer', async ({ from, answer }) => {
  const p = peers[from];
  if (p) {
    try { await p.pc.setRemoteDescription(new RTCSessionDescription(answer)); } catch (e) { console.error(e); }
    renderVoiceGrid();
  }
});

socket.on('voice-members-update', ({ channelId, members: m }) => {
  updateVoiceSidebar(channelId, m);
  if (voiceCh === channelId) renderVoiceGrid();
});

socket.on('peer-screen-share', ({ socketId: sid, sharing, username }) => {
  if (sharing && username) toast(`${username} демонстрирует экран`, 'info');
  setTimeout(renderVoiceGrid, 500);
});

socket.on('peer-mute-toggle', () => renderVoiceGrid());
socket.on('peer-video-toggle', () => setTimeout(renderVoiceGrid, 300));

// ========================================
// ========== UTILS =======================
// ========================================
function esc(t) {
  if (!t) return '';
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

function formatText(t) {
  if (!t) return '';
  let s = esc(t);
  s = s.replace(/```([\s\S]*?)```/g, '<pre style="background:var(--bg3);padding:8px;border-radius:4px;margin:4px 0;overflow-x:auto"><code>$1</code></pre>');
  s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.*?)\*/g, '<em>$1</em>');
  s = s.replace(/__(.*?)__/g, '<u>$1</u>');
  s = s.replace(/~~(.*?)~~/g, '<del>$1</del>');
  s = s.replace(/`(.*?)`/g, '<code style="background:var(--bg3);padding:2px 4px;border-radius:3px">$1</code>');
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return s;
}

function scrollBottom() {
  requestAnimationFrame(() => {
    const el = $('msg-scroll');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function showTyping() {
  const names = Object.keys(typMap).filter(n => n !== me?.username);
  if (!names.length) {
    $('typing-row').classList.add('hidden');
    return;
  }
  $('typing-row').classList.remove('hidden');
  $('typing-who').textContent =
    names.length === 1 ? `${names[0]} печатает...` :
    names.length === 2 ? `${names[0]} и ${names[1]} печатают...` :
    `${names.length} чел. печатают...`;
}

// Ready
$('inp-user').focus();
console.log('Discord Clone v3.1 ready');