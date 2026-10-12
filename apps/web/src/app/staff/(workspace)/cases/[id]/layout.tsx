import type { ReactNode } from "react";
import { CaseWorkspace } from "@/components/suite/case-workspace";
export default function Layout({ children }: { children: ReactNode }) {
  return <CaseWorkspace>{children}</CaseWorkspace>;
}
