import React, { useEffect, useRef, useState } from "react";
import { X, type IconNode } from "lucide";
import { renderIcon } from "./icons.js";

export function ConsoleIcon({ icon }: { icon: IconNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { ref.current?.replaceChildren(renderIcon(icon)); }, [icon]);
  return <span ref={ref} className="console-icon" aria-hidden="true" />;
}

export function Modal({ title, children, close, locked = false }: {
  title: string; children: React.ReactNode; close: () => void; locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const closeAnimation = useRef<Animation | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      closeAnimation.current?.cancel();
      dialog?.close();
      requestAnimationFrame(() => { if (opener?.isConnected && !document.querySelector("dialog[open]")) opener.focus({ preventScroll: true }); });
    };
  }, []);
  const dismiss = () => {
    if (locked || closing) return;
    const dialog = ref.current;
    if (!dialog || matchMedia("(prefers-reduced-motion: reduce)").matches) { close(); return; }
    setClosing(true);
    const animation = dialog.animate([{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(4px)" }],
      { duration: 140, easing: "ease-out", fill: "forwards" });
    closeAnimation.current = animation;
    void animation.finished.then(close).catch(() => {});
  };
  return <dialog className="modal" ref={ref} onCancel={(event) => { event.preventDefault(); dismiss(); }} aria-label={title}>
    <header><h2>{title}</h2><button className="icon-button" aria-label="关闭" title="关闭" onClick={dismiss} disabled={locked || closing}><ConsoleIcon icon={X} /></button></header>
    <div className="modal-content" inert={closing}>{children}</div>
  </dialog>;
}
