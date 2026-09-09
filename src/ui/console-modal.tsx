import React, { useEffect, useRef } from "react";
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
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog className="modal" ref={ref} onCancel={(event) => { event.preventDefault(); if (!locked) close(); }} aria-label={title}>
    <header><h2>{title}</h2><button className="icon-button" aria-label="关闭" title="关闭" onClick={close} disabled={locked}><ConsoleIcon icon={X} /></button></header>
    <div className="modal-content">{children}</div>
  </dialog>;
}
