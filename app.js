// ====== Состояние ======
const chatEl = document.getElementById('chat');
const inp = document.getElementById('inp');
const sendBtn = document.getElementById('send');
const micBtn = document.getElementById('mic');
const statusEl = document.getElementById('status');

let history = JSON.parse(localStorage.getItem('assistant_history') || '[]');
let voiceOutputEnabled = true;

renderHistory();

// ====== Рендер сообщений ======
function addMsg(text, who, save = true) {
  const div = document.createElement('div');
  div.className = 'msg ' + who;
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
  if (save && who !== 'system') {
    history.push({ role: who === 'user' ? 'user' : 'assistant', content: text });
    localStorage.setItem('assistant_history', JSON.stringify(history.slice(-20)));
  }
  return div;
}

function renderHistory() {
  if (history.length === 0) {
    addMsg('Привет! Я твой помощник. Спроси меня что-нибудь, скажи "погода" или нажми таймер.', 'bot', false);
    return;
  }
  history.forEach(m => {
    const div = document.createElement('div');
    div.className = 'msg ' + (m.role === 'user' ? 'user' : 'bot');
    div.textContent = m.content;
    chatEl.appendChild(div);
  });
  chatEl.scrollTop = chatEl.scrollHeight;
}

// ====== Локальные команды (работают без сети) ======
function tryLocalCommand(text) {
  const t = text.toLowerCase().trim();

  if (t.includes('сколько времени') || t.includes('который час')) {
    const now = new Date();
    return `Сейчас ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  const timerMatch = t.match(/таймер на (\d+)\s*(минут|мин|секунд|сек)/);
  if (timerMatch) {
    const num = parseInt(timerMatch[1]);
    const unit = timerMatch[2];
    const ms = unit.startsWith('сек') ? num * 1000 : num * 60 * 1000;
    setTimeout(() => {
      speak(`Время вышло! ${num} ${unit} прошло.`);
      addMsg(`⏰ Таймер сработал: ${num} ${unit}`, 'bot');
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }, ms);
    return `Таймер запущен на ${num} ${unit}. Я напомню.`;
  }

  if (t.includes('погода')) {
    return 'lookup_weather';
  }

  return null;
}

async function getWeather() {
  try {
    statusEl.textContent = 'ищу локацию...';
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
    );
    const { latitude, longitude } = pos.coords;
    statusEl.textContent = 'запрашиваю погоду...';
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`
    );
    const data = await res.json();
    const w = data.current_weather;
    statusEl.textContent = 'готов';
    return `Сейчас ${w.temperature}°C, скорость ветра ${w.windspeed} км/ч.`;
  } catch (e) {
    statusEl.textContent = 'готов';
    return 'Не смог получить погоду — разреши доступ к геолокации или проверь соединение.';
  }
}

// ====== Ключ API (нужен вне claude.ai) ======
function getApiKey() {
  return localStorage.getItem('assistant_api_key') || '';
}

function ensureApiKeyPrompt() {
  const bar = document.getElementById('apikey-bar');
  if (getApiKey()) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  bar.innerHTML = 'Нужен API-ключ Anthropic, чтобы приложение отвечало. <a href="#" id="setkey" style="color:#4f6ef7">Ввести ключ</a>';
  document.getElementById('setkey').addEventListener('click', (e) => {
    e.preventDefault();
    const key = prompt('Вставь свой Anthropic API-ключ (console.anthropic.com):');
    if (key) {
      localStorage.setItem('assistant_api_key', key.trim());
      ensureApiKeyPrompt();
    }
  });
}
ensureApiKeyPrompt();

// ====== Отправка в ИИ (Claude API) ======
async function askAI(text) {
  const key = getApiKey();
  if (!key) {
    ensureApiKeyPrompt();
    return 'Сначала добавь API-ключ (см. сообщение выше), чтобы я мог отвечать.';
  }
  statusEl.textContent = 'думаю...';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: history.slice(-10)
      })
    });
    const data = await res.json();
    statusEl.textContent = 'готов';
    return (data.content || []).map(b => b.text || '').join('\n').trim() || 'Извини, не получилось ответить.';
  } catch (e) {
    statusEl.textContent = 'готов';
    return 'Не удалось связаться с сервером. Проверь интернет.';
  }
}

// ====== Основной обработчик ======
async function handleInput(text) {
  if (!text.trim()) return;
  addMsg(text, 'user');
  inp.value = '';

  const local = tryLocalCommand(text);
  if (local === 'lookup_weather') {
    const w = await getWeather();
    addMsg(w, 'bot');
    speak(w);
    return;
  }
  if (local) {
    addMsg(local, 'bot');
    speak(local);
    return;
  }

  const reply = await askAI(text);
  addMsg(reply, 'bot');
  speak(reply);
}

sendBtn.addEventListener('click', () => handleInput(inp.value));
inp.addEventListener('keydown', e => { if (e.key === 'Enter') handleInput(inp.value); });

document.querySelectorAll('.quick-actions button').forEach(btn => {
  btn.addEventListener('click', () => handleInput(btn.dataset.cmd));
});

// ====== Голосовой ввод (распознавание речи) ======
let recognition = null;
let listening = false;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'ru-RU';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript;
    handleInput(text);
  };
  recognition.onend = () => {
    listening = false;
    micBtn.classList.remove('active');
    statusEl.textContent = 'готов';
  };
  recognition.onerror = () => {
    listening = false;
    micBtn.classList.remove('active');
    statusEl.textContent = 'готов';
  };
} else {
  micBtn.style.display = 'none';
}

micBtn.addEventListener('click', () => {
  if (!recognition) return;
  if (listening) {
    recognition.stop();
  } else {
    listening = true;
    micBtn.classList.add('active');
    statusEl.textContent = 'слушаю...';
    recognition.start();
  }
});

// ====== Голосовой вывод (озвучка ответа) ======
function speak(text) {
  if (!voiceOutputEnabled || !window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'ru-RU';
  utter.rate = 1.0;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

// ====== Регистрация Service Worker (для установки как приложение) ======
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
