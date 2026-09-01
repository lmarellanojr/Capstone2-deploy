"use client";

import React, { useState } from "react";

interface Tab {
  label: string;
  id: string;
  content: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
}

export function Tabs({ tabs, defaultTab }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id);

  return (
    <div>
      <div className="flex border-b border-border gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition whitespace-nowrap ${
              activeTab === tab.id
                ? "border-brand text-text-main"
                : "border-transparent text-text-muted hover:text-text-main"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-6">{tabs.find((tab) => tab.id === activeTab)?.content}</div>
    </div>
  );
}