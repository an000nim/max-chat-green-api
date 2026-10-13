import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageCircle, Search, Plus, Send, Paperclip, Smile, MoreHorizontal, Phone, Video, ArrowLeft, Settings2, X, Check, CheckCheck, LoaderCircle, LogOut, KeyRound, UserRound, ChevronDown } from 'lucide-react';
import './style.css';

const API_DEFAULT = 'https://api.green-api.com';
const textOf = (n) => n?.body?.messageData?.textMessageData?.textMessage ?? n?.body?.messageData?.extendedTextMessageData?.text ?? n?.body?.messageData?.text ?? n?.messageData?.textMessageData?.textMessage ?? '';
const senderOf = (n) => n?.body?.senderData?.sender ?? n?.body?.senderData?.chatId ?? n?.body?.sender ?? '';
const chatOf = (n) => n?.body?.senderData?.chatId ?? n?.body?.chatId ?? '';
const timeOf = (n) => n?.body?.timestamp ? new Date(n.body.timestamp * 1000) : new Date();
const fmtTime = (date) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date instanceof Date ? date : new Date(date));
const digits = (s) => s.replace(/\D/g, '');

function App() {
  const [credentials, setCredentials] = useState({ id: '', token: '', apiUrl: API_DEFAULT });
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState('');
  const [activeId, setActiveId] = useState('');
  const [chats, setChats] = useState([]);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const [polling, setPolling] = useState(false);
  const [newChat, setNewChat] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const busy = useRef(false);
  const active = chats.find(c => c.id === activeId);

  const endpoint = useCallback((method) => `${credentials.apiUrl.replace(/\/+$/, '')}/waInstance${encodeURIComponent(credentials.id)}/${method}/${encodeURIComponent(credentials.token)}`, [credentials]);
  const call = useCallback(async (method, options = {}) => {
    const res = await fetch(endpoint(method) + (options.query || ''), { method: options.method || 'GET', headers: options.body ? { 'Content-Type': 'application/json' } : undefined, body: options.body ? JSON.stringify(options.body) : undefined });
    const raw = await res.text();
    let data; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    if (!res.ok) throw new Error(data?.message || data?.error || `Ошибка API: ${res.status}`);
    return data;
  }, [endpoint]);

  const connect = async (e) => {
    e?.preventDefault(); setError('');
    if (!credentials.id.trim() || !credentials.token.trim()) { setError('Введите idInstance и apiTokenInstance.'); return; }
    setConnecting(true);
    try {
      const result = await call('getStateInstance');
      if (result?.stateInstance && result.stateInstance !== 'authorized') {
        setError(`Инстанс не авторизован (состояние: ${result.stateInstance}). Авторизуйте его в личном кабинете GREEN-API.`);
        return;
      }
      setConnected(true); setPolling(true);
    } catch (err) { setError(err.message || 'Не удалось подключиться. Проверьте данные и адрес API.'); }
    finally { setConnecting(false); }
  };
  const disconnect = () => { setConnected(false); setPolling(false); setActiveId(''); setChats([]); setError(''); };

  const addChat = (e) => {
    e?.preventDefault(); setError('');
    const number = digits(phone);
    if (number.length < 7) { setError('Введите номер телефона в международном формате.'); return; }
    const id = `${number}@c.us`;
    setChats(prev => prev.some(c => c.id === id) ? prev : [{ id, name: `+${number}`, messages: [], unread: 0 }, ...prev]);
    setActiveId(id); setPhone(''); setNewChat(false); setMobileChat(true);
  };

  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!draft.trim() || !active || !connected || sending) return;
    const message = draft.trim(); setDraft(''); setSending(true); setError('');
    if (message.length > 4000) { setDraft(message); setSending(false); setError('Сообщение не должно превышать 4000 символов.'); return; }
    const tempId = `local-${Date.now()}`;
    const now = new Date();
    setChats(prev => prev.map(c => c.id === active.id ? { ...c, messages: [...c.messages, { id: tempId, text: message, outgoing: true, time: now, status: 'sending' }] } : c));
    try {
      const result = await call('sendMessage', { method: 'POST', body: { chatId: active.id, message } });
      setChats(prev => prev.map(c => c.id === active.id ? { ...c, lastMessage: message, updated: now, messages: c.messages.map(m => m.id === tempId ? { ...m, id: result?.idMessage || tempId, status: 'sent' } : m) } : c));
    } catch (err) {
      setError(`Не удалось отправить сообщение: ${err.message}`);
      setChats(prev => prev.map(c => c.id === active.id ? { ...c, messages: c.messages.map(m => m.id === tempId ? { ...m, status: 'failed' } : m) } : c));
    } finally { setSending(false); }
  };

  useEffect(() => {
    if (!connected || !polling) return;
    let cancelled = false;
    const poll = async () => {
      if (busy.current || cancelled) return;
      busy.current = true;
      try {
        const notice = await call('receiveNotification');
        if (cancelled || !notice?.receiptId) return;
        const body = notice.body || {};
        if (body.typeWebhook === 'incomingMessageReceived') {
          const chatId = chatOf(notice);
          const text = textOf(notice);
          if (chatId && text) {
            const sender = body.senderData?.chatName || body.senderData?.senderContactName || body.senderData?.senderPhoneNumber || senderOf(notice);
            const date = timeOf(notice);
            setChats(prev => {
              const exists = prev.find(c => c.id === chatId);
              const msgId = body.idMessage || `${notice.receiptId}`;
              if (exists?.messages.some(m => m.id === msgId)) return prev;
              const msg = { id: msgId, text, outgoing: false, time: date };
              const senderName = typeof sender === 'string' && /\D/.test(sender) && !sender.includes('@') ? sender : `+${digits(sender || chatId)}`;
              if (exists) return prev.map(c => c.id === chatId ? { ...c, name: c.name || senderName, lastMessage: text, updated: date, unread: chatId === activeId ? 0 : (c.unread || 0) + 1, messages: [...c.messages, msg] } : c).sort((a,b) => new Date(b.updated || 0) - new Date(a.updated || 0));
              return [{ id: chatId, name: senderName, messages: [msg], lastMessage: text, updated: date, unread: chatId === activeId ? 0 : 1 }, ...prev];
            });
          }
        }
        await call(`deleteNotification/${encodeURIComponent(notice.receiptId)}`, { method: 'DELETE' });
      } catch (err) { if (!cancelled) setError(`Получение сообщений: ${err.message}`); }
      finally { busy.current = false; }
    };
    poll();
    const timer = window.setInterval(poll, 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [connected, polling, call, activeId]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [active?.messages?.length, activeId]);
  const filtered = chats.filter(c => `${c.name} ${c.lastMessage || ''}`.toLowerCase().includes(query.toLowerCase()));

  return <main className="app-shell">
    <aside className={`sidebar ${mobileChat ? 'sidebar-hidden' : ''}`}>
      <header className="side-head">
        <div className="brand"><span className="brand-mark"><MessageCircle size={20} strokeWidth={2.5}/></span><span>MAX</span></div>
        <div className="head-actions"><button className="icon-btn" aria-label="Настройки" onClick={() => setShowSettings(true)}><Settings2 size={20}/></button><button className="icon-btn" aria-label="Новый чат" onClick={() => setNewChat(true)}><Plus size={21}/></button></div>
      </header>
      <div className="search-box"><Search size={18}/><input placeholder="Поиск" value={query} onChange={e => setQuery(e.target.value)} /><kbd>⌘ K</kbd></div>
      <div className="chat-section"><div className="section-label">Сообщения <ChevronDown size={14}/></div>
        {filtered.length ? <div className="chat-list">{filtered.map(c => <button key={c.id} className={`chat-row ${activeId === c.id ? 'selected' : ''}`} onClick={() => { setActiveId(c.id); setMobileChat(true); setChats(p => p.map(x => x.id === c.id ? {...x, unread: 0} : x)); }}>
          <Avatar name={c.name}/><span className="chat-info"><span className="chat-title"><b>{c.name}</b><time>{c.updated ? fmtTime(c.updated) : ''}</time></span><span className="chat-preview">{c.lastMessage || 'Новый чат'}</span></span>{c.unread > 0 && <i className="unread">{c.unread}</i>}
        </button>)}</div> : <div className="empty-list"><div className="empty-illustration"><MessageCircle size={27}/></div><b>{query ? 'Ничего не найдено' : 'Пока нет чатов'}</b><span>{query ? 'Попробуйте изменить запрос' : 'Создайте чат, чтобы начать общение'}</span>{!query && <button className="text-action" onClick={() => setNewChat(true)}>Новый чат</button>}</div>}
      </div>
      <footer className="profile-row"><div className="profile-avatar">М</div><div className="profile-text"><b>Мой аккаунт</b><span className={connected ? 'online' : ''}>{connected ? 'Подключен к GREEN-API' : 'Не подключен'}</span></div><button aria-label="Открыть настройки" className="icon-btn" onClick={() => setShowSettings(true)}><MoreHorizontal size={20}/></button></footer>
    </aside>
    <section className={`conversation ${mobileChat ? 'conversation-visible' : ''}`}>
      {active ? <><header className="conversation-head"><button className="icon-btn back-btn" onClick={() => setMobileChat(false)} aria-label="Назад"><ArrowLeft size={21}/></button><Avatar name={active.name} large/><div className="contact"><b>{active.name}</b><span><i className="status-dot"/>{connected ? 'в сети' : 'чат'}</span></div><div className="conversation-actions"><button className="icon-btn" title="Поиск в чате"><Search size={19}/></button><button className="icon-btn" title="Позвонить"><Phone size={19}/></button><button className="icon-btn" title="Видеозвонок"><Video size={20}/></button><button className="icon-btn" title="Ещё"><MoreHorizontal size={21}/></button></div></header>
        <div className="messages" ref={scrollRef}><div className="date-divider"><span>Сегодня</span></div>{active.messages.map(m => <div key={m.id} className={`message-line ${m.outgoing ? 'outgoing' : ''}`}><div className={`bubble ${m.outgoing ? 'bubble-out' : 'bubble-in'} ${m.status === 'failed' ? 'bubble-failed' : ''}`}><div className="bubble-text">{m.text}</div><div className="bubble-meta"><time>{fmtTime(m.time)}</time>{m.outgoing && (m.status === 'sending' ? <LoaderCircle className="spin" size={13}/> : m.status === 'failed' ? <span className="failed-mark">!</span> : <CheckCheck size={15} className="read-mark"/>)}</div></div></div>)}{active.messages.length === 0 && <div className="start-chat"><Avatar name={active.name} large/><b>{active.name}</b><span>Это начало вашей переписки</span></div>}</div>
        {error && <div className="inline-error"><span>{error}</span><button onClick={() => setError('')} aria-label="Закрыть"><X size={15}/></button></div>}
        <form className="composer" onSubmit={sendMessage}><button type="button" className="icon-btn attach" aria-label="Прикрепить файл" title="Поддерживаются только текстовые сообщения"><Paperclip size={21}/></button><textarea value={draft} maxLength={4000} onChange={e => setDraft(e.target.value)} placeholder={connected ? 'Написать сообщение…' : 'Подключите GREEN-API в настройках'} disabled={!connected} rows="1" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e); } }}/><button type="button" className="icon-btn emoji" aria-label="Эмодзи" onClick={() => setDraft(d => d.length < 4000 ? d + '🙂' : d)}><Smile size={21}/></button><button className="send-btn" disabled={!connected || !draft.trim() || sending} aria-label="Отправить"><Send size={19}/></button></form><div className="compose-hint">Enter — отправить <span>·</span> Shift + Enter — новая строка</div>
      </> : <div className="welcome"><div className="welcome-art"><div className="art-circle"><MessageCircle size={46}/><span className="sparkle">✦</span></div></div><h1>Общайтесь без границ</h1><p>Выберите чат или начните новую переписку</p><button className="primary-btn" onClick={() => setNewChat(true)}><Plus size={18}/>Новый чат</button><div className="welcome-foot"><span className={`connection-pill ${connected ? 'connected' : ''}`}><i/> {connected ? 'GREEN-API подключен' : 'Подключите GREEN-API в настройках'}</span></div></div>}
    </section>
    {showSettings && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setShowSettings(false)}><section className="modal"><header className="modal-head"><div><span className="modal-icon"><Settings2 size={19}/></span><div><h2>Настройки подключения</h2><p>Данные вашего инстанса GREEN-API</p></div></div><button className="icon-btn" onClick={() => setShowSettings(false)} aria-label="Закрыть"><X size={20}/></button></header><form onSubmit={e => { connect(e); }} className="settings-form"><label>Адрес API<input value={credentials.apiUrl} onChange={e => setCredentials({...credentials, apiUrl:e.target.value})} placeholder="https://api.green-api.com" /></label><label>Идентификатор инстанса<span className="input-icon"><UserRound size={16}/><input value={credentials.id} onChange={e => setCredentials({...credentials, id:e.target.value})} placeholder="idInstance" autoComplete="off" /></span></label><label>Токен инстанса<span className="input-icon"><KeyRound size={16}/><input type="password" value={credentials.token} onChange={e => setCredentials({...credentials, token:e.target.value})} placeholder="apiTokenInstance" autoComplete="new-password" /></span></label>{error && <div className="form-error">{error}<button type="button" onClick={() => setError('')}><X size={14}/></button></div>}<div className="security-note"><KeyRound size={15}/> Данные хранятся только в памяти этой вкладки и не сохраняются.</div><div className="modal-actions">{connected && <button type="button" className="disconnect-btn" onClick={disconnect}><LogOut size={16}/>Отключить</button>}<button className="primary-btn" disabled={connecting}>{connecting ? <LoaderCircle className="spin" size={17}/> : connected ? <Check size={17}/> : null}{connecting ? 'Подключение…' : connected ? 'Подключено' : 'Подключиться'}</button></div></form><a className="help-link" href="https://console.green-api.com" target="_blank" rel="noreferrer">Открыть личный кабинет GREEN-API ↗</a></section></div>}
    {newChat && <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setNewChat(false)}><section className="modal new-chat-modal"><header className="modal-head"><div><span className="modal-icon"><MessageCircle size={19}/></span><div><h2>Новый чат</h2><p>Введите номер телефона получателя</p></div></div><button className="icon-btn" onClick={() => setNewChat(false)} aria-label="Закрыть"><X size={20}/></button></header><form className="settings-form" onSubmit={addChat}><label>Номер телефона<span className="phone-field"><span>+</span><input autoFocus value={phone} onChange={e => setPhone(e.target.value)} placeholder="7 999 123-45-67" inputMode="tel" /></span><small>Введите номер в международном формате, например 79991234567</small></label>{error && <div className="form-error">{error}<button type="button" onClick={() => setError('')}><X size={14}/></button></div>}<div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setNewChat(false)}>Отмена</button><button className="primary-btn"><MessageCircle size={17}/>Открыть чат</button></div></form></section></div>}
  </main>;
}
function Avatar({name, large=false}) { const palette=['#e8d9ff','#d9eeff','#ffe1d9','#dbf2e5','#ffedc9','#f9d9e7']; let index=0; for (const c of (name||'М')) index += c.charCodeAt(0); return <span className={`avatar ${large?'avatar-large':''}`} style={{'--avatar-bg':palette[index%palette.length]}}>{(name||'М').replace(/^\+/,'').slice(-1)}</span>; }

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
