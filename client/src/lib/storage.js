function storage(name) {
  return {
    getItem(key) { try { return window[name].getItem(key); } catch { return null; } },
    setItem(key, value) { try { window[name].setItem(key, value); } catch { /* keep memory state */ } },
    removeItem(key) { try { window[name].removeItem(key); } catch { /* storage denied */ } },
  };
}
export const safeLocalStorage = storage('localStorage');
export const safeSessionStorage = storage('sessionStorage');
