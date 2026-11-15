import { memo, useMemo } from "react";
import {
  arrowPath,
  boardInk,
  drawPath,
  isTextElement,
  verdictMark,
  type CanvasElement,
  type ImageElement,
  type Verdict,
} from "./model";
import { CanvasImage } from "./image-crop";
import { layoutSticky } from "./layout";

// Editing one note must not rebuild the other notes, images, or stroke paths.
export const CanvasArtwork = memo(function CanvasArtwork({
  element,
  threadId,
  zoom,
  editing,
}: {
  element: CanvasElement;
  threadId: string;
  zoom: number;
  editing: boolean;
}) {
  const layout = useMemo(
    () =>
      element.type === "sticky" && !editing ? layoutSticky(element) : null,
    [element, editing],
  );
  const stroke =
    element.type === "draw" || element.type === "arrow" ? element : null;
  const path = useMemo(
    () =>
      stroke &&
      (stroke.type === "arrow" ? arrowPath(stroke) : drawPath(stroke)),
    [stroke?.type, stroke?.points, stroke?.strokeWidth],
  );
  return (
    <g data-element={element.id} data-element-type={element.type}>
      {element.type === "image" ? (
        <>
          <g opacity={element.verdict === "no" ? 0.4 : undefined}>
            <CanvasImage image={element} threadId={threadId} />
          </g>
          {element.verdict && (
            <VerdictMark image={{ ...element, verdict: element.verdict }} />
          )}
        </>
      ) : isTextElement(element) ? (
        <>
          <rect
            x={element.x + (element.type === "sticky" ? 0.5 : 0)}
            y={element.y + (element.type === "sticky" ? 0.5 : 0)}
            width={element.width - (element.type === "sticky" ? 1 : 0)}
            height={element.height - (element.type === "sticky" ? 1 : 0)}
            rx={element.type === "sticky" ? 8 : undefined}
            fill={
              element.type === "sticky" ? element.background : "transparent"
            }
            stroke={element.type === "sticky" ? "#242424" : undefined}
            strokeOpacity={0.12}
          />
          {!editing && (
            <text
              fontFamily="Canvas Sans, sans-serif"
              fontSize={layout?.fontSize ?? element.fontSize}
              style={
                layout
                  ? {
                      fontKerning: "none",
                      fontVariantLigatures: "none",
                      fontFeatureSettings: '"kern" 0, "liga" 0',
                    }
                  : undefined
              }
              fill={
                element.type === "sticky"
                  ? element.color
                  : boardInk(element.color)
              }
              xmlSpace="preserve"
            >
              {(layout?.lines ?? element.text.split("\n")).map(
                (line, index) => (
                  <tspan
                    key={index}
                    x={element.x + (layout?.padding ?? 0)}
                    y={
                      element.y +
                      (layout?.padding ?? 0) +
                      (layout?.fontSize ?? element.fontSize) * (1 + index * 1.3)
                    }
                  >
                    {line}
                  </tspan>
                ),
              )}
            </text>
          )}
        </>
      ) : (
        <g transform={`translate(${element.x} ${element.y})`}>
          <path
            d={path!}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(element.strokeWidth, 12 / zoom)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={path!}
            fill="none"
            stroke={boardInk(element.color)}
            strokeWidth={element.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
    </g>
  );
});
function VerdictMark({
  image,
}: {
  image: ImageElement & { verdict: Verdict };
}) {
  const mark = verdictMark(image);
  return (
    <g pointerEvents="none" data-verdict={image.verdict}>
      <rect
        x={image.x}
        y={image.y}
        width={image.width}
        height={image.height}
        fill="none"
        stroke={mark.color}
        strokeWidth={mark.frame}
      />
      <circle
        cx={mark.cx}
        cy={mark.cy}
        r={mark.radius}
        fill={mark.color}
        stroke="#fff"
        strokeWidth={mark.radius * 0.12}
      />
      <path
        d={mark.path}
        fill="none"
        stroke="#fff"
        strokeWidth={mark.radius * 0.22}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}
