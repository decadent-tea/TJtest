import { useId } from "react";

/** A schematic of the evidence chain, never a representation of a live run. */
export function TraceMap() {
  const id = useId();

  return (
    <figure className="trace-map">
      <div className="trace-map-heading">
        <span>从操作到证据</span>
        <span>流程示意</span>
      </div>
      <svg
        className="trace-map-canvas"
        viewBox="0 0 560 320"
        width="560"
        height="320"
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
      >
        <title id={`${id}-title`}>
          页面操作、接口调用与异常证据汇集为体检报告
        </title>
        <desc id={`${id}-description`}>
          页面操作关联接口调用，接口信息与异常证据共同构成可追溯的体检报告。本图仅为流程示意。
        </desc>
        <defs>
          <pattern
            id={`${id}-grid`}
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="0.8" fill="var(--border)" />
          </pattern>
          <marker
            id={`${id}-arrow`}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path
              d="m1 1 5 3-5 3"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="1.4"
            />
          </marker>
        </defs>
        <rect
          width="560"
          height="320"
          fill={`url(#${id}-grid)`}
          opacity="0.7"
        />

        <g
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1.5"
          markerEnd={`url(#${id}-arrow)`}
        >
          <path d="M192 70H209Q217 70 217 78V124Q217 132 225 132H235" />
          <path d="M319 172V188Q319 196 311 196H292Q284 196 284 204V218" />
          <path d="M368 256H425" />
          <path
            d="M403 132H473Q481 132 481 140V215"
            strokeDasharray="4 5"
            opacity="0.55"
          />
        </g>
        <g
          fill="var(--muted-foreground)"
          fontSize="10"
          fontFamily="ui-monospace, monospace"
          letterSpacing="1"
        >
          <text x="34" y="18">
            BROWSER
          </text>
          <text x="235" y="82">
            NETWORK
          </text>
          <text x="34" y="292">
            TRACE / EVIDENCE
          </text>
        </g>

        <g
          fill="var(--surface, var(--background))"
          stroke="var(--border)"
          strokeWidth="1"
        >
          <rect x="34" y="30" width="158" height="80" rx="8" />
          <rect x="235" y="92" width="168" height="80" rx="8" />
          <rect x="200" y="218" width="168" height="76" rx="8" />
          <rect
            x="425"
            y="215"
            width="112"
            height="82"
            rx="8"
            stroke="var(--primary)"
          />
        </g>

        <g
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="49" y="46" width="19" height="15" rx="2" />
          <path d="M49 51h19m-8 5 6 8 1-4 4-1z" />
          <path d="m259 108-6 6 6 6m10-12 6 6-6 6m-5-15-3 18" />
          <path d="M218 235h17v16h-17zM221 247l4-4 3 2 4-6" />
          <circle cx="223" cy="240" r="1" />
          <path d="M441 230h11l5 5v16h-16zM452 230v6h5m-12 5h8m-8 5h6" />
        </g>

        <g fill="var(--foreground)" fontSize="14" fontWeight="600">
          <text x="78" y="60">
            页面操作
          </text>
          <text x="285" y="119">
            接口调用
          </text>
          <text x="247" y="247">
            异常证据
          </text>
          <text x="441" y="273">
            体检报告
          </text>
        </g>
        <g fill="var(--muted-foreground)" fontSize="11">
          <text x="49" y="91">
            点击 · 输入 · 页面跳转
          </text>
          <text x="250" y="152">
            请求 · 响应 · 调用关联
          </text>
          <text x="215" y="276">
            截图 · 日志 · 问题定位
          </text>
        </g>
      </svg>
      <figcaption className="trace-map-footer">
        关联页面行为与接口证据，让每个问题都有迹可循。
      </figcaption>
    </figure>
  );
}
