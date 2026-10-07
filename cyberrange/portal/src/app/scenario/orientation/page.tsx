'use client'

import React from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  ChevronRight,
  Clock,
  Compass,
  FileText,
  Flag,
  HelpCircle,
  Keyboard,
  Layers,
  Terminal,
  Zap,
} from 'lucide-react'
import { LayoutWrapper } from '@/components/layout/LayoutWrapper'

export default function ScenarioOrientationPage() {
  return (
    <LayoutWrapper>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Breadcrumb Header */}
        <div className="bg-secondary border border-border rounded-xl p-3 sm:px-4 py-2.5 shadow-card -mt-2">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
            <Link
              href="/scenarios"
              className="text-text-muted hover:text-brand transition font-medium rounded focus-ring"
            >
              My Labs
            </Link>
            <ChevronRight size={14} className="text-text-faint" aria-hidden="true" />
            <span className="font-semibold text-text-main" aria-current="page">
              Scenario 0 — Lab Orientation
            </span>
          </nav>
        </div>

        {/* Hero Section */}
        <div className="card-surface p-6 sm:p-8 bg-gradient-to-br from-secondary via-secondary to-brand/5 border-border">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-brand text-white mb-3">
              <Compass size={13} aria-hidden="true" />
              Welcome to Cyber Range Labs
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-text-main leading-tight">
              How Your Lab Environment Works
            </h1>
            <p className="mt-2 text-sm sm:text-base text-text-secondary leading-relaxed">
              Every scenario provisions an isolated, hands-on lab sandbox with private attacker and target virtual machines.
              Review these core concepts before starting Scenario 1.
            </p>
          </div>
        </div>

        {/* Core Concepts Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Tile 1: Two-Pane Screen */}
          <div className="card-surface p-5 space-y-3">
            <div className="flex items-center gap-2.5 text-brand font-bold text-sm">
              <Layers size={18} aria-hidden="true" />
              <span>1. The Two-Pane Split Screen</span>
            </div>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              On desktop, your screen splits into two panels:
            </p>
            <ul className="text-xs text-text-muted space-y-1.5 list-disc pl-5">
              <li>
                <strong className="text-text-main">Left Pane (Exercise):</strong> Shows your current task objective, instructions, real-time score status, and collapsible walkthrough guide.
              </li>
              <li>
                <strong className="text-text-main">Right Pane (Terminal):</strong> Provides your live, interactive Kali Linux terminal frame connecting to the lab network.
              </li>
            </ul>
          </div>

          {/* Tile 2: Automated Scoring */}
          <div className="card-surface p-5 space-y-3">
            <div className="flex items-center gap-2.5 text-brand font-bold text-sm">
              <Zap size={18} aria-hidden="true" />
              <span>2. How Automated Scoring Works</span>
            </div>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              The range monitors your session commands in the background:
            </p>
            <ul className="text-xs text-text-muted space-y-1.5 list-disc pl-5">
              <li>
                Commands run in your Kali terminal register automatically within seconds.
              </li>
              <li>
                Always press <code className="bg-muted px-1 rounded text-text-main">Enter</code> after completing a command so it flushes to history.
              </li>
              <li>
                Each milestone updates in place from pending to scored with points awarded.
              </li>
            </ul>
          </div>

          {/* Tile 3: CLI Prompts & Typing Habit */}
          <div className="card-surface p-5 space-y-3">
            <div className="flex items-center gap-2.5 text-brand font-bold text-sm">
              <Terminal size={18} aria-hidden="true" />
              <span>3. Terminal Prompts & Typing Habits</span>
            </div>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              Pay close attention to your prompt indicator:
            </p>
            <ul className="text-xs text-text-muted space-y-1.5 list-disc pl-5">
              <li>
                <code className="bg-muted px-1 rounded text-text-main font-mono">$</code> — Standard Linux shell on your Kali machine.
              </li>
              <li>
                <code className="bg-muted px-1 rounded text-text-main font-mono">msf &gt;</code> — Metasploit framework console.
              </li>
              <li>
                <code className="bg-muted px-1 rounded text-text-main font-mono">meterpreter &gt;</code> — Meterpreter session prompt after exploitation.
              </li>
            </ul>
            <div className="p-2.5 rounded-lg bg-chip/60 border border-border flex items-center gap-2 text-xs text-text-muted">
              <Keyboard size={14} className="text-brand shrink-0" aria-hidden="true" />
              <span>Type commands yourself rather than pasting to build muscle memory!</span>
            </div>
          </div>

          {/* Tile 4: The Final Flag */}
          <div className="card-surface p-5 space-y-3 border-brand/20 bg-brand/5">
            <div className="flex items-center gap-2.5 text-brand font-bold text-sm">
              <Flag size={18} aria-hidden="true" />
              <span>4. Capturing the Flag</span>
            </div>
            <div className="p-3 rounded-lg bg-secondary border border-border">
              <p className="text-xs sm:text-sm font-semibold text-text-main leading-relaxed">
                The one thing you submit yourself is the final flag.
              </p>
              <p className="text-xs text-text-muted mt-1 leading-relaxed">
                Early tasks score automatically via the range engine. The final task is a flag capture step where you enter the discovered token or answer directly into the submission box.
              </p>
            </div>
          </div>
        </div>

        {/* Getting Help & Session Management */}
        <div className="card-surface p-5 space-y-3">
          <div className="flex items-center gap-2.5 text-text-main font-bold text-sm">
            <HelpCircle size={18} className="text-brand" aria-hidden="true" />
            <span>Where to Get Help in Lab</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-text-secondary">
            <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-1">
              <span className="font-semibold text-text-main flex items-center gap-1.5">
                <FileText size={14} className="text-brand" aria-hidden="true" />
                Walkthrough Guide
              </span>
              <p className="text-text-muted">
                Expand the guide in the left pane or export as a PDF anytime.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-1">
              <span className="font-semibold text-text-main flex items-center gap-1.5">
                <Clock size={14} className="text-brand" aria-hidden="true" />
                Session Timer
              </span>
              <p className="text-text-muted">
                Track remaining pod duration in the footer countdown bar.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-1">
              <span className="font-semibold text-text-main flex items-center gap-1.5">
                <Compass size={14} className="text-brand" aria-hidden="true" />
                Big Picture Modal
              </span>
              <p className="text-text-muted">
                Click &quot;Big Picture&quot; in the header to review the attack topology.
              </p>
            </div>
          </div>
        </div>

        {/* Action CTAs */}
        <div className="card-surface p-6 flex flex-wrap items-center justify-between gap-4 border-border">
          <div>
            <h2 className="text-base font-bold text-text-main">
              Ready to begin?
            </h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Launch Scenario 1: Network Reconnaissance &amp; Exploitation.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/scenarios"
              className="px-4 py-2 rounded-lg border border-border bg-secondary text-text-main text-xs font-semibold hover:bg-muted transition focus-ring"
            >
              Back to My Labs
            </Link>
            <Link
              href="/scenario/01"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand text-white text-xs font-bold hover:bg-brand-hover transition shadow-sm focus-ring"
            >
              <span>Start Scenario 1</span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </LayoutWrapper>
  )
}
