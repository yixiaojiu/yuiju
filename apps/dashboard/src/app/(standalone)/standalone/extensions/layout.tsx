import type { ReactNode } from "react";
import "./layout.css";

export default function StandaloneExtensionLayout({ children }: { children: ReactNode }) {
  return <div data-extension-standalone>{children}</div>;
}
