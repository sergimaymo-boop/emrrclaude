interface ToastProps {
  message: string;
  tone: "success" | "error" | "info";
}

export function Toast({ message, tone }: ToastProps) {
  return <div className={`toast toast-${tone}`}>{message}</div>;
}
