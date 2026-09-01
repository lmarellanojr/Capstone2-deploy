"use client";

import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";

interface LayoutWrapperProps {
  children: React.ReactNode;
  onSearch?: (query: string) => void;
}

export function LayoutWrapper({ children, onSearch }: LayoutWrapperProps) {
  return (
    <div className="flex h-screen bg-primary">
      <div className="hidden lg:block w-64 flex-shrink-0">
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <TopNav onSearch={onSearch} showLogo />
        <main className="flex-1 overflow-y-auto">
          <div className="p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}