// Detail history is session-only. Catalog records and browser history are never entries here.
export function createDetailNavigation({ limit = 20, showLibrary = () => {}, notify = () => {} } = {}) {
  const adapters = new Map();
  let current = null;
  let history = [];
  let transitioning = false;
  const copy = (entry) => entry && ({ type: entry.type, id: entry.id });
  const available = (entry) => Boolean(entry && adapters.get(entry.type)?.exists(entry.id));
  function updateBack() {
    for (const [type, adapter] of adapters) adapter.setBack?.(current?.type === type && history.length > 0);
  }
  function display(target, nextHistory, context) {
    if (transitioning || !available(target)) return false;
    transitioning = true;
    const previous = current;
    current = null; // Programmatic close notifications must not end the incoming session.
    try {
      if (previous) adapters.get(previous.type).hide();
      history = nextHistory;
      current = copy(target);
      const adapter = adapters.get(target.type);
      showLibrary(adapter.library);
      adapter.open(target.id, context);
      updateBack();
      return true;
    } finally { transitioning = false; }
  }
  return {
    register(type, adapter) { adapters.set(type, adapter); updateBack(); },
    getState() { return { current: copy(current), history: history.map(copy) }; },
    open(type, id, { related = false, context } = {}) {
      const target = { type, id };
      if (!available(target) || transitioning) return false;
      if (related && current?.type === type && current.id === id) return true;
      const next = related && current ? [...history, copy(current)].slice(-limit) : [];
      return display(target, next, context);
    },
    back() {
      if (transitioning || !current) return false;
      const remaining = [...history];
      let skipped = false;
      while (remaining.length) {
        const target = remaining.pop();
        if (!available(target)) { skipped = true; continue; }
        const opened = display(target, remaining);
        if (skipped) notify('An earlier item is no longer available and was skipped.');
        return opened;
      }
      history = [];
      updateBack();
      if (skipped) notify('Earlier items are no longer available.');
      return false;
    },
    close(type, { focus = true } = {}) {
      if (transitioning || (type && current?.type !== type)) return;
      const previous = current;
      current = null;
      history = [];
      if (previous) {
        const adapter = adapters.get(previous.type);
        adapter.hide();
        if (focus) adapter.restoreFocus?.();
      }
      updateBack();
    },
    mainLibrary() { this.close(undefined, { focus: false }); }
  };
}

export const detailNavigation = createDetailNavigation({
  showLibrary(library) {
    // Internal transitions replace only the Library hash; they do not add browser Back entries.
    if (window.history?.replaceState) window.history.replaceState(window.history.state, '', `#${library}`);
    else window.location.hash = `#${library}`;
    document.dispatchEvent(new CustomEvent('detail:screen-change'));
  },
  notify(message) { window.alert(message); }
});
