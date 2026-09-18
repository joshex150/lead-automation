import { ImageResponse } from "next/og";

/*
 * The social card, drawn rather than stored.
 *
 * A shared link with no image gets a grey box in WhatsApp and Slack, which is
 * where this would actually be pasted. Generating it keeps the wording in the
 * same file as the page rather than in a PNG somebody has to remember to redraw.
 *
 * Satori, which renders this, is not a browser. Any element with more than one
 * child needs an explicit display, and mixing a string and a span inside one
 * element throws rather than laying out. So every line here is a flex row of
 * whole spans, which is also why the highlighted words are their own elements.
 */
export const runtime = "edge";
export const alt = "YEAN Leads, find the businesses with no website";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#f4f4f5";
const DIM = "#a1a1aa";
const FAINT = "#71717a";
const ACCENT = "#17a34a";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#08080a",
          padding: "66px 72px",
          color: INK,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", width: 32, height: 32, background: ACCENT }} />
          <span style={{ fontSize: 30, fontWeight: 700 }}>YEAN</span>
          <span style={{ fontSize: 30, fontWeight: 700, color: ACCENT }}>Leads</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              // Satori does not read the two-value gap shorthand, and the words
              // ran together on the line that wrapped. Given separately it does.
              columnGap: 18,
              rowGap: 6,
              fontSize: 66,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              maxWidth: 1000,
            }}
          >
            <span>Find the businesses with</span>
            <span style={{ color: ACCENT }}>no website,</span>
            <span>and write to them first</span>
          </div>
          <div style={{ display: "flex", marginTop: 30, fontSize: 26, color: DIM, maxWidth: 900, lineHeight: 1.45 }}>
            <span>
              Scan a city, check what each business has online, score how badly they need a site. Nothing is sent until
              you approve it.
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 44, fontSize: 21, color: FAINT }}>
          <span>735 businesses in one scan</span>
          <span>18 searches</span>
          <span>5.5 minutes</span>
        </div>
      </div>
    ),
    size,
  );
}
