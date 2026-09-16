"use client";

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { LayoutWrapper } from "@/components/layout/LayoutWrapper";
import { ProvisioningOverlay } from "@/components/provisioning/ProvisioningOverlay";
import { PodStatus } from "@/components/provisioning/PodStatus";
import { Button } from "@/components/ui";
import { useScenarios } from "@/hooks/useScenarios";
import { provisioning, type Pod } from "@/lib/api";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const scenarios = useScenarios();
  const [isProvisioningOpen, setIsProvisioningOpen] = useState(false);
  const [podCreated, setPodCreated] = useState(false);
  // Filtered list length (PROVISIONING / ACTIVE / DESTROYING) from PodStatus.
  const [activePodCount, setActivePodCount] = useState(0);
  // Bumped after create so PodStatus refreshes the list immediately.
  const [listRefreshSignal, setListRefreshSignal] = useState(0);
  const [earned, setEarned] = useState<number | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    let active = true;
    provisioning
      .getProgress()
      .then((data) => {
        if (!active) return;
        const seen = new Set<string>();
        let pts = 0;
        for (const row of data.milestones) {
          if (row.status !== "PASS") continue;
          const sid = String(row.scenario_id).padStart(2, "0");
          const key = `${sid}:${row.milestone_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const sc = scenarios.find((s) => s.id === sid);
          const m = sc?.milestones.find((x) => x.id === row.milestone_id);
          if (m) pts += m.points;
        }
        setEarned(pts);
      })
      .catch(() => {
        if (active) setEarned(0);
      });
    return () => {
      active = false;
    };
  }, [status, scenarios]);

  const handleProvisioningSubmit = useCallback(() => {
    setPodCreated(true);
    setListRefreshSignal((n) => n + 1);
    setTimeout(() => setPodCreated(false), 3000);
  }, []);

  const handlePodsChange = useCallback((pods: Pod[]) => {
    setActivePodCount(pods.length);
  }, []);

  const firstName = session?.user?.name?.split(" ")[0] || "Student";
  const totalPoints = scenarios.reduce(
    (sum, s) => sum + s.milestones.reduce((m, x) => m + x.points, 0),
    0
  );

  return (
    <LayoutWrapper>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-main">Welcome back, {firstName}!</h1>
        <p className="text-text-muted mt-1">Manage your labs and track your progress</p>
      </div>

      {podCreated && (
        <div className="mb-6 p-4 alert-success text-sm">
          Pod created successfully! Check your active pods below.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[
          { label: "Labs Available", value: String(scenarios.length) },
          {
            label: "Score",
            value:
              earned === null
                ? "…"
                : `${earned.toLocaleString()} / ${totalPoints.toLocaleString()}`,
          },
          { label: "Active Pods", value: String(activePodCount) },
        ].map((stat) => (
          <div key={stat.label} className="card-surface p-6 text-center">
            <p className="text-3xl font-bold text-text-main">{stat.value}</p>
            <p className="text-sm text-text-muted mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 card-surface p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-text-main">Continue Learning</h2>
            <Link href="/scenarios" className="text-sm text-brand font-semibold hover:underline">
              View all labs →
            </Link>
          </div>
          <div className="space-y-3">
            {scenarios.slice(0, 3).map((s) => (
              <Link
                key={s.id}
                href={`/scenario/${s.id}`}
                className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-muted transition"
              >
                <div>
                  <p className="font-semibold text-text-main text-sm">{s.name}</p>
                  <p className="text-xs text-text-muted mt-0.5">{s.description.slice(0, 60)}…</p>
                </div>
                <span className="text-xs font-semibold text-brand">Start →</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="card-surface p-6">
          <h2 className="text-lg font-bold text-text-main mb-4">Quick Actions</h2>
          <Button variant="primary" onClick={() => setIsProvisioningOpen(true)} className="w-full mb-3">
            + Provision New Pod
          </Button>
          <Button variant="outline" onClick={() => router.push("/scenarios")} className="w-full">
            Browse Lab Catalog
          </Button>
        </div>
      </div>

      <PodStatus
        onConnect={(pod) => {
          if (pod.scenario_id) {
            router.push(`/scenario/${pod.scenario_id}`);
          } else {
            router.push("/scenarios");
          }
        }}
        refreshSignal={listRefreshSignal}
        onPodsChange={handlePodsChange}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        <div className="card-surface p-6">
          <h3 className="text-lg font-bold text-text-main mb-4">Getting Started</h3>
          <ul className="space-y-2 text-text-muted text-sm">
            <li>1. Browse the lab catalog or provision a pod</li>
            <li>2. Wait for the pod to reach ACTIVE status</li>
            <li>3. Connect to open the terminal</li>
            <li>4. Complete scenario objectives for points</li>
            <li>5. Destroy the pod when finished</li>
          </ul>
        </div>

        <div className="card-surface p-6">
          <h3 className="text-lg font-bold text-text-main mb-4">Resource Limits</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Active pods per student</span>
              <span className="font-semibold text-text-main">1</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Host capacity</span>
              <span className="font-semibold text-text-main">1 pod</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Memory per pod</span>
              <span className="font-semibold text-text-main">~4 GB</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Storage per pod</span>
              <span className="font-semibold text-text-main">~7 GB</span>
            </div>
          </div>
        </div>
      </div>

      <ProvisioningOverlay
        isOpen={isProvisioningOpen}
        onClose={() => setIsProvisioningOpen(false)}
        onSubmit={handleProvisioningSubmit}
      />
    </LayoutWrapper>
  );
}