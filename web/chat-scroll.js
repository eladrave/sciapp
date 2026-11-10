// #main owns scrolling. The message list itself is deliberately not a nested
// scroller, so replacing a review card cannot scroll an outer page or the input.
export function createChatScroll(container, messages, isActive) {
 let following = true, saved = null, frame = null, userRevision = 0, userIntentUntil = 0;
 const atLatest = () => container.scrollHeight - container.clientHeight - container.scrollTop < 64;
 function cancelFrame() { if(frame != null) cancelAnimationFrame(frame); frame = null; }
 function capture() {
  if (!isActive()) return saved;
  const top = container.getBoundingClientRect().top;
  const anchor = [...messages.children].find(row => row.dataset.messageId && row.getBoundingClientRect().bottom > top);
  return { latest: following, top: container.scrollTop, id: anchor?.dataset.messageId, offset: anchor ? anchor.getBoundingClientRect().top - top : 0 };
 }
 function apply(position) {
  if (!isActive()) return;
  if (position?.latest) { container.scrollTop = container.scrollHeight; following = true; }
  else if (position) {
   const anchor = [...messages.children].find(row => row.dataset.messageId === position.id);
   container.scrollTop = anchor ? container.scrollTop + anchor.getBoundingClientRect().top - container.getBoundingClientRect().top - position.offset : position.top;
   following = false;
  }
 }
 function settle(position) {
  cancelFrame(); apply(position); const revision = userRevision;
  frame = requestAnimationFrame(() => { frame = null; if(revision === userRevision) { apply(position); saved = capture(); } });
 }
 container.addEventListener('scroll', () => { if(isActive()) { if(atLatest()) following = true; else if(Date.now() < userIntentUntil) following = false; saved = capture(); } }, {passive:true});
 const userMovement = () => { userRevision++; userIntentUntil = Date.now() + 1500; cancelFrame(); };
 container.addEventListener('wheel',userMovement,{passive:true});
 // A tap on an answer or the composer is not a request to scroll away.
 container.addEventListener('touchmove',userMovement,{passive:true});
 container.addEventListener('pointerdown',event=>{if(event.target===container)userMovement();},{passive:true});
 container.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))userMovement();});
 // Composer growth, the Android keyboard, and error banners resize #main.
 // Follow the last turn only if the reader was already following it.
 if (typeof ResizeObserver !== 'undefined') {
  const resize = new ResizeObserver(() => { if(isActive() && following) settle({latest:true}); });
  resize.observe(container);
  // Photos, reminder cards and the working indicator can grow without resizing #main.
  resize.observe(messages.parentElement || messages);
 }
 return {
  capture,
  afterRender(position) { settle(position || {latest:true}); },
  latest() { following = true; saved = {latest:true}; settle(saved); },
  save() { saved = capture(); cancelFrame(); },
  restore() { settle(saved || {latest:true}); },
  reset() { cancelFrame(); following = true; saved = null; userRevision++; },
 };
}
