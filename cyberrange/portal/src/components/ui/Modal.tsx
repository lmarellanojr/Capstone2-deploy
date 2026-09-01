import React from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function Modal({ isOpen, onClose, children }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="relative bg-secondary border border-border rounded-xl shadow-card-hover max-w-2xl w-full">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-muted hover:text-text-main z-10"
          aria-label="Close modal"
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}

interface ModalHeaderProps {
  title: string;
  onClose?: () => void;
}

export function ModalHeader({ title, onClose }: ModalHeaderProps) {
  return (
    <div className="border-b border-border px-8 py-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-text-main">{title}</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-main"
            aria-label="Close modal"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

interface ModalBodyProps {
  children: React.ReactNode;
}

export function ModalBody({ children }: ModalBodyProps) {
  return <div className="px-8 py-6">{children}</div>;
}

interface ModalFooterProps {
  children: React.ReactNode;
}

export function ModalFooter({ children }: ModalFooterProps) {
  return (
    <div className="border-t border-border px-8 py-4 flex justify-end gap-4 bg-muted/50 rounded-b-xl">
      {children}
    </div>
  );
}