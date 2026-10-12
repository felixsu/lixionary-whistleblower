import type { ReactNode } from "react";
import { StaffWorkspace } from "@/components/suite/staff-workspace";
export default function Layout({ children }: { children: ReactNode }) {
  return <StaffWorkspace>{children}</StaffWorkspace>;
}
