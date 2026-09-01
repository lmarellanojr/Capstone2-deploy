interface TerminalIFrameProps {
  guacamoleUrl: string
  podId: number
  scenarioName: string
}

export function TerminalIFrame({ guacamoleUrl, podId, scenarioName }: TerminalIFrameProps) {
  return (
    <div className="bg-secondary border border-border rounded-xl overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="bg-primary px-6 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="font-bold text-text-main">Pod {podId}</h3>
          <p className="text-sm text-text-muted">{scenarioName}</p>
        </div>

        <div className="flex gap-2">
          <button className="px-3 py-1 bg-secondary hover:bg-primary rounded text-sm text-text-muted hover:text-text-main transition">
            📋 Copy
          </button>
          <button className="px-3 py-1 bg-secondary hover:bg-primary rounded text-sm text-text-muted hover:text-text-main transition">
            🖼️ Screenshot
          </button>
          <button className="px-3 py-1 bg-danger hover:bg-red-700 text-white rounded text-sm transition">
            ⏹️ Disconnect
          </button>
        </div>
      </div>

      {/* IFrame Container */}
      <div className="flex-1 bg-black">
        <iframe
          src={guacamoleUrl}
          className="w-full h-full border-none"
          title={`Terminal for Pod ${podId}`}
          allowFullScreen
        />
      </div>
    </div>
  )
}
