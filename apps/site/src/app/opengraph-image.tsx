import { ImageResponse } from "next/og";

export const alt = "Viora — Tell V. Fill Shifts. Find Work.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#fbfbfa",
          padding: "64px",
        }}
      >
        <svg width="120" height="120" viewBox="0 0 32 32">
          <path
            d="M7 8 L16 24 L25 8"
            fill="none"
            stroke="#1F4DFF"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div
          style={{
            marginTop: 40,
            fontSize: 64,
            fontWeight: 700,
            color: "#10141b",
            textAlign: "center",
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
          }}
        >
          Tell V. Fill Shifts. Find Work.
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 32,
            color: "#565d67",
            textAlign: "center",
          }}
        >
          Flexible staffing, starting with education.
        </div>
      </div>
    ),
    { ...size },
  );
}
