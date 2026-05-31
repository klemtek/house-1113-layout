import {
  ArrowDownToLine,
  BringToFront,
  CheckCircle2,
  Copy,
  DoorOpen,
  Download,
  Eye,
  EyeOff,
  FileJson,
  Focus,
  Grid3X3,
  Home,
  Image as ImageIcon,
  Import,
  Layers,
  LineChart,
  Lock,
  Maximize,
  Minus,
  MousePointer2,
  Move,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Printer,
  Redo2,
  RotateCcw,
  Ruler,
  Save,
  Settings,
  Share2,
  SquareDashed,
  StickyNote,
  TextCursorInput,
  Trash2,
  Undo2,
  Unlock,
  BrickWall,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fixedDetails, initialLabels, initialWalls, openings, PLAN_META } from "./planData.js";
import {
  cleanNumber,
  clamp,
  calculateAreaMetrics,
  doorArcPath,
  downloadBlob,
  formatArea,
  formatFeet,
  snapPoint,
  wallLength,
  wallOrientation
} from "./geometry.js";

const STORAGE_KEY = "house-1113-cad-state-v9";
const VERSION_STORAGE_KEY = "house-1113-cad-versions-v1";
const AUTH_KEY = "house-1113-cad-auth-v1";
const PASSCODE_HASH = "a020f494725f155483b7f74deab8543a22df5fad74d508ecfd9f5c1bb0f79b92";
const SNAP_GRID = 0.5;
const DEFAULT_ZOOM = 0.78;

const toolItems = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "wall", label: "Wall", icon: BrickWall },
  { id: "label", label: "Label", icon: TextCursorInput },
  { id: "note", label: "Idea", icon: StickyNote },
  { id: "measure", label: "Measure", icon: Ruler }
];

function cloneInitialState() {
  return {
    walls: initialWalls.map((wall) => ({ ...wall })),
    labels: initialLabels.map((label) => ({ ...label })),
    updatedAt: new Date().toISOString()
  };
}

function cloneProject(project) {
  return {
    walls: project.walls.map((wall) => ({ ...wall })),
    labels: project.labels.map((label) => ({ ...label })),
    updatedAt: project.updatedAt || new Date().toISOString()
  };
}

function normalizeProject(value) {
  if (!value || !Array.isArray(value.walls) || !Array.isArray(value.labels)) return null;
  return {
    walls: value.walls.map((wall) => ({ ...wall })),
    labels: value.labels.map((label) => ({ ...label })),
    updatedAt: value.updatedAt || new Date().toISOString()
  };
}

function encodeProject(project) {
  const bytes = new TextEncoder().encode(JSON.stringify(cloneProject(project)));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeProject(encoded) {
  const padded = `${encoded.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat((4 - (encoded.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return normalizeProject(JSON.parse(new TextDecoder().decode(bytes)));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.append(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
}

function loadInitialState() {
  try {
    const sharedProject = new URLSearchParams(window.location.hash.slice(1)).get("plan");
    if (sharedProject) {
      const decoded = decodeProject(sharedProject);
      if (decoded) return decoded;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return cloneInitialState();
    return normalizeProject(JSON.parse(saved)) || cloneInitialState();
  } catch {
    return cloneInitialState();
  }
}

function loadVersions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(VERSION_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((version) => ({ ...version, project: normalizeProject(version.project) }))
      .filter((version) => version.id && version.name && version.project);
  } catch {
    return [];
  }
}

function App() {
  const [authenticated, setAuthenticated] = useState(() => sessionStorage.getItem(AUTH_KEY) === "ok");
  const svgRef = useRef(null);
  const importRef = useRef(null);
  const [project, setProject] = useState(loadInitialState);
  const [versions, setVersions] = useState(loadVersions);
  const [versionName, setVersionName] = useState("");
  const [selected, setSelected] = useState({ type: "wall", id: "i-family-short" });
  const [tool, setTool] = useState("select");
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [showUnderlay, setShowUnderlay] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [draftWall, setDraftWall] = useState(null);
  const [hoverPoint, setHoverPoint] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [status, setStatus] = useState("Saved");
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);

  const selectedWall = useMemo(
    () => (selected.type === "wall" ? project.walls.find((wall) => wall.id === selected.id) : null),
    [project.walls, selected]
  );
  const selectedLabel = useMemo(
    () => (selected.type === "label" ? project.labels.find((label) => label.id === selected.id) : null),
    [project.labels, selected]
  );
  const areaMetrics = useMemo(
    () => calculateAreaMetrics(project.walls, project.labels, PLAN_META.bounds, SNAP_GRID),
    [project.walls, project.labels]
  );
  const selectedLabelMetric = selectedLabel ? areaMetrics[selectedLabel.id] : null;

  const viewBox = useMemo(() => {
    const bounds = PLAN_META.bounds;
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const width = bounds.width / zoom;
    const height = bounds.height / zoom;
    return `${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`;
  }, [zoom]);
  const instruction = draftWall
    ? "Click the wall end point. It will snap to the grid and nearby walls."
    : tool === "wall"
      ? "Click once to start a wall, then click again to place the end."
      : tool === "label"
        ? "Click the plan to add a room label."
        : tool === "note"
          ? "Click the plan to add a wish-list note."
          : "Drag interior walls or labels. Exterior walls stay locked.";

  const commitProject = useCallback((updater, message = "Saved") => {
    setProject((current) => {
      setHistory((items) => [...items.slice(-39), current]);
      setFuture([]);
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...next, updatedAt: new Date().toISOString() };
    });
    setStatus(message);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }, [project]);

  useEffect(() => {
    localStorage.setItem(VERSION_STORAGE_KEY, JSON.stringify(versions));
  }, [versions]);

  const canvasPoint = useCallback(
    (event, forceSnap = false) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const transformed = point.matrixTransform(svg.getScreenCTM().inverse());
      const raw = { x: transformed.x, y: transformed.y };
      if (snapEnabled || forceSnap) return snapPoint(raw, SNAP_GRID);
      return raw;
    },
    [snapEnabled]
  );

  const updateWall = useCallback((id, patch) => {
    setProject((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      walls: current.walls.map((wall) => (wall.id === id ? { ...wall, ...patch } : wall))
    }));
    setStatus("Saved");
  }, []);

  const updateLabel = useCallback((id, patch) => {
    setProject((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      labels: current.labels.map((label) => (label.id === id ? { ...label, ...patch } : label))
    }));
    setStatus("Saved");
  }, []);

  const snapToWallAnchor = useCallback(
    (point) => {
      const anchors = [];
      for (const wall of project.walls) {
        anchors.push({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 });
        if (Math.abs(wall.y1 - wall.y2) < 0.05 && point.x >= Math.min(wall.x1, wall.x2) && point.x <= Math.max(wall.x1, wall.x2)) {
          anchors.push({ x: point.x, y: wall.y1 });
        }
        if (Math.abs(wall.x1 - wall.x2) < 0.05 && point.y >= Math.min(wall.y1, wall.y2) && point.y <= Math.max(wall.y1, wall.y2)) {
          anchors.push({ x: wall.x1, y: point.y });
        }
      }
      let best = point;
      let bestDistance = 0.85;
      for (const anchor of anchors) {
        const distance = Math.hypot(anchor.x - point.x, anchor.y - point.y);
        if (distance < bestDistance) {
          best = anchor;
          bestDistance = distance;
        }
      }
      return { x: cleanNumber(best.x), y: cleanNumber(best.y) };
    },
    [project.walls]
  );

  const alignedDraftEnd = useCallback(
    (point) => {
      if (!draftWall) return point;
      return snapToWallAnchor(point);
    },
    [draftWall, snapToWallAnchor]
  );
  const draftEnd = draftWall && hoverPoint ? alignedDraftEnd(hoverPoint) : draftWall ? { x: draftWall.x + 7, y: draftWall.y + 4 } : null;

  const placeWallPoint = useCallback(
    (rawPoint) => {
      if (!draftWall) {
        setDraftWall(snapToWallAnchor(rawPoint));
        setStatus("Wall start set");
        return;
      }
      const aligned = alignedDraftEnd(rawPoint);
      const id = `wall-${Date.now()}`;
      const newWall = {
        id,
        kind: "interior",
        x1: cleanNumber(draftWall.x),
        y1: cleanNumber(draftWall.y),
        x2: cleanNumber(aligned.x),
        y2: cleanNumber(aligned.y),
        thickness: 0.34
      };
      commitProject((current) => ({ ...current, walls: [...current.walls, newWall] }), "Wall added");
      setSelected({ type: "wall", id });
      setDraftWall(null);
      setHoverPoint(null);
      setTool("select");
    },
    [alignedDraftEnd, commitProject, draftWall, snapToWallAnchor]
  );

  const placeLabelPoint = useCallback(
    (point, mode = tool) => {
      const id = `${mode}-${Date.now()}`;
      const nextLabel = {
        id,
        x: cleanNumber(point.x),
        y: cleanNumber(point.y),
        name: mode === "note" ? "Wish List Idea" : "New Room",
        dimensions: "",
        note: mode === "note" ? "Add contractor note here." : ""
      };
      commitProject((current) => ({ ...current, labels: [...current.labels, nextLabel] }), "Label added");
      setSelected({ type: "label", id });
      setTool("select");
    },
    [commitProject, tool]
  );

  const handleCanvasDown = (event) => {
    if (event.target !== svgRef.current && event.target.dataset.canvas !== "true") return;
    const point = canvasPoint(event);
    if (tool === "label" || tool === "note") {
      placeLabelPoint(point, tool);
      return;
    }
    if (tool === "wall") {
      placeWallPoint(point);
      return;
    }
    setSelected({ type: null, id: null });
  };

  const handleWallPointerDown = (event, wall) => {
    event.stopPropagation();
    if (tool === "wall") {
      placeWallPoint(canvasPoint(event));
      return;
    }
    if (tool === "label" || tool === "note") {
      placeLabelPoint(canvasPoint(event), tool);
      return;
    }
    setSelected({ type: "wall", id: wall.id });
    if (tool !== "select" || wall.kind === "exterior") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      mode: "wall",
      id: wall.id,
      start: canvasPoint(event),
      original: { ...wall }
    });
  };

  const handleEndpointDown = (event, wall, endpoint) => {
    event.stopPropagation();
    setSelected({ type: "wall", id: wall.id });
    if (wall.kind === "exterior") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      mode: "endpoint",
      endpoint,
      id: wall.id,
      start: canvasPoint(event),
      original: { ...wall }
    });
  };

  const handleLabelPointerDown = (event, label) => {
    event.stopPropagation();
    if (tool === "label" || tool === "note") {
      placeLabelPoint(canvasPoint(event), tool);
      return;
    }
    setSelected({ type: "label", id: label.id });
    if (tool !== "select") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      mode: "label",
      id: label.id,
      start: canvasPoint(event),
      original: { ...label }
    });
  };

  const handlePointerMove = (event) => {
    if (draftWall) setHoverPoint(canvasPoint(event));
    if (!dragState) return;
    const point = canvasPoint(event);
    const dx = point.x - dragState.start.x;
    const dy = point.y - dragState.start.y;
    if (dragState.mode === "label") {
      updateLabel(dragState.id, {
        x: cleanNumber(dragState.original.x + dx),
        y: cleanNumber(dragState.original.y + dy)
      });
      return;
    }
    if (dragState.mode === "wall") {
      const orientation = wallOrientation(dragState.original);
      const moveX = orientation === "horizontal" ? 0 : dx;
      const moveY = orientation === "vertical" ? 0 : dy;
      updateWall(dragState.id, {
        x1: cleanNumber(dragState.original.x1 + moveX),
        y1: cleanNumber(dragState.original.y1 + moveY),
        x2: cleanNumber(dragState.original.x2 + moveX),
        y2: cleanNumber(dragState.original.y2 + moveY)
      });
      return;
    }
    if (dragState.mode === "endpoint") {
      const original = dragState.original;
      const patch = {};
      const keyX = dragState.endpoint === "start" ? "x1" : "x2";
      const keyY = dragState.endpoint === "start" ? "y1" : "y2";
      patch[keyX] = cleanNumber(original[keyX] + dx);
      patch[keyY] = cleanNumber(original[keyY] + dy);
      updateWall(dragState.id, patch);
    }
  };

  const handlePointerUp = () => {
    if (dragState) {
      setHistory((items) => [...items.slice(-39), project]);
      setFuture([]);
      setStatus("Saved");
    }
    setDragState(null);
  };

  const resetPlan = () => {
    const next = cloneInitialState();
    commitProject(next, "Reset to traced plan");
    setSelected({ type: "wall", id: "i-family-short" });
    setDraftWall(null);
    setHoverPoint(null);
  };

  const undo = () => {
    setHistory((items) => {
      if (!items.length) return items;
      const previous = items[items.length - 1];
      setFuture((futureItems) => [project, ...futureItems]);
      setProject(previous);
      setStatus("Undo");
      return items.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((items) => {
      if (!items.length) return items;
      const next = items[0];
      setHistory((historyItems) => [...historyItems.slice(-39), project]);
      setProject(next);
      setStatus("Redo");
      return items.slice(1);
    });
  };

  const cleanSvgString = useCallback(() => {
    const labelMarkup = project.labels
      .map((label) => {
        const metric = areaMetrics[label.id];
        const areaText = metric?.detectedArea ? formatArea(metric.detectedArea) : "";
        return `
      <g transform="translate(${label.x} ${label.y})" text-anchor="middle">
        <text y="-0.8" font-family="Inter, Arial, sans-serif" font-size="1.55" font-weight="700" fill="#15191d">${escapeXml(label.name)}</text>
        <text y="1.15" font-family="Inter, Arial, sans-serif" font-size="1.28" fill="#15191d">${escapeXml(label.dimensions || "")}</text>
        ${areaText ? `<text y="2.85" font-family="Inter, Arial, sans-serif" font-size="1.05" fill="#0f766e">${escapeXml(areaText)}</text>` : ""}
        ${label.note ? `<text y="${areaText ? "4.45" : "3.1"}" font-family="Inter, Arial, sans-serif" font-size="1.05" fill="#0f766e">${escapeXml(label.note)}</text>` : ""}
      </g>`;
      })
      .join("");
    const wallMarkup = project.walls
      .map(
        (wall) => `
      <line x1="${wall.x1}" y1="${wall.y1}" x2="${wall.x2}" y2="${wall.y2}" stroke="${wall.kind === "exterior" ? "#111518" : "#20252a"}" stroke-width="${wall.thickness}" stroke-linecap="square" />`
      )
      .join("");
    const openingMarkup = openings.map((opening) => renderOpeningMarkup(opening)).join("");
    const fixedDetailMarkup = fixedDetails.map((detail) => renderFixedDetailMarkup(detail)).join("");
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${PLAN_META.bounds.x} ${PLAN_META.bounds.y} ${PLAN_META.bounds.width} ${PLAN_META.bounds.height}" width="1800" height="1484">
  <rect x="${PLAN_META.bounds.x}" y="${PLAN_META.bounds.y}" width="${PLAN_META.bounds.width}" height="${PLAN_META.bounds.height}" fill="#ffffff"/>
  <g opacity="0.16" stroke="#8da0a7" stroke-width="0.04">
    ${Array.from({ length: 95 }, (_, index) => `<line x1="${index + 4}" y1="0" x2="${index + 4}" y2="75"/>`).join("")}
    ${Array.from({ length: 76 }, (_, index) => `<line x1="4" y1="${index}" x2="95" y2="${index}"/>`).join("")}
  </g>
  <g>${wallMarkup}</g>
  <g>${openingMarkup}</g>
  <g>${fixedDetailMarkup}</g>
  <g>${labelMarkup}</g>
</svg>`;
  }, [areaMetrics, project.labels, project.walls]);

  const exportSvg = () => {
    downloadBlob(new Blob([cleanSvgString()], { type: "image/svg+xml" }), "1113-45th-ave-ne-editable-plan.svg");
  };

  const exportJson = () => {
    downloadBlob(
      new Blob([JSON.stringify({ meta: PLAN_META, ...project }, null, 2)], { type: "application/json" }),
      "1113-45th-ave-ne-plan-project.json"
    );
  };

  const exportPng = async () => {
    const svgText = cleanSvgString();
    const svgBlob = new Blob([svgText], { type: "image/svg+xml" });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 2400;
      canvas.height = 1956;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, "1113-45th-ave-ne-plan.png");
        URL.revokeObjectURL(url);
      }, "image/png");
    };
    image.src = url;
  };

  const importJson = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.walls) || !Array.isArray(parsed.labels)) return;
    commitProject({ walls: parsed.walls, labels: parsed.labels, updatedAt: new Date().toISOString() }, "Project imported");
    event.target.value = "";
  };

  const saveVersion = () => {
    const name = versionName.trim() || `Version ${versions.length + 1}`;
    const now = new Date().toISOString();
    const existing = versions.find((version) => version.name.toLowerCase() === name.toLowerCase());
    const nextVersion = {
      id: existing?.id || `version-${Date.now()}`,
      name,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      project: { ...cloneProject(project), updatedAt: now }
    };
    setVersions((items) => [nextVersion, ...items.filter((item) => item.id !== nextVersion.id)]);
    setVersionName(name);
    setStatus(`Saved version: ${name}`);
  };

  const loadVersion = (id) => {
    const version = versions.find((item) => item.id === id);
    if (!version) return;
    commitProject(cloneProject(version.project), `Loaded version: ${version.name}`);
    setVersionName(version.name);
    setSelected({ type: null, id: null });
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  const copyVersionLink = async () => {
    const encoded = encodeProject(project);
    const link = `${window.location.origin}${window.location.pathname}${window.location.search}#plan=${encoded}`;
    await copyText(link);
    setStatus("Version link copied");
  };

  const quickEditLabel = (label) => {
    const name = window.prompt("Room or section label", label.name);
    if (name === null) return;
    const dimensions = window.prompt("Dimensions", label.dimensions);
    if (dimensions === null) return;
    const note = window.prompt("Wish list / contractor note", label.note || "");
    if (note === null) return;
    commitProject(
      (current) => ({
        ...current,
        labels: current.labels.map((item) => (
          item.id === label.id
            ? { ...item, name: name.trim() || item.name, dimensions: dimensions.trim(), note: note.trim() }
            : item
        ))
      }),
      "Label updated"
    );
    setSelected({ type: "label", id: label.id });
  };

  const shareSummary = async () => {
    const summary = `${PLAN_META.title}\nInterior walls: ${project.walls.filter((wall) => wall.kind === "interior").length}\nLabels: ${project.labels.length}\nExport SVG/PNG/JSON from the app for contractors.`;
    if (navigator.share) {
      await navigator.share({ title: PLAN_META.title, text: summary });
    } else {
      await copyText(summary);
      setStatus("Share summary copied");
    }
  };

  if (!authenticated) {
    return <PasswordGate onUnlock={() => setAuthenticated(true)} />;
  }

  const deleteSelection = () => {
    if (selected.type === "wall" && selectedWall?.kind === "interior") {
      commitProject((current) => ({ ...current, walls: current.walls.filter((wall) => wall.id !== selected.id) }), "Wall deleted");
      setSelected({ type: null, id: null });
    }
    if (selected.type === "label") {
      commitProject((current) => ({ ...current, labels: current.labels.filter((label) => label.id !== selected.id) }), "Label deleted");
      setSelected({ type: null, id: null });
    }
  };

  return (
    <div className="app-shell">
      <TopBar
        zoom={zoom}
        setZoom={setZoom}
        status={status}
        onExportSvg={exportSvg}
        onExportPng={exportPng}
        onExportJson={exportJson}
        onImport={() => importRef.current?.click()}
        onShare={shareSummary}
        onPrint={() => window.print()}
        onUndo={undo}
        onRedo={redo}
        canUndo={history.length > 0}
        canRedo={future.length > 0}
        versionName={versionName}
        setVersionName={setVersionName}
        versions={versions}
        onSaveVersion={saveVersion}
        onLoadVersion={loadVersion}
        onCopyVersionLink={copyVersionLink}
      />
      <aside className="left-rail" aria-label="Drawing tools">
        <div className="rail-brand" title="Home">
          <Home size={24} />
        </div>
        <div className="tool-list">
          {toolItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`tool-button ${tool === item.id ? "active" : ""}`}
                onClick={() => {
                  setTool(item.id);
                  setDraftWall(null);
                  setHoverPoint(null);
                }}
                title={item.label}
              >
                <Icon size={21} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
        <div className="rail-footer">
          <button className="icon-button dark" title="Layers">
            <Layers size={20} />
          </button>
          <button className="icon-button dark" title="Settings">
            <Settings size={20} />
          </button>
        </div>
      </aside>
      <main className={`workspace ${showInspector ? "" : "wide"}`}>
        <div className="canvas-toolbar">
          <div className="segmented">
            <button className={tool === "select" ? "selected" : ""} onClick={() => setTool("select")} title="Select">
              <MousePointer2 size={18} />
            </button>
            <button onClick={() => setZoom((value) => clamp(value - 0.15, 0.55, 2.4))} title="Zoom out">
              <ZoomOut size={18} />
            </button>
            <button onClick={() => setZoom((value) => clamp(value + 0.15, 0.65, 2.4))} title="Zoom in">
              <ZoomIn size={18} />
            </button>
            <button onClick={() => setZoom(DEFAULT_ZOOM)} title="Fit">
              <Focus size={18} />
              <span>Fit</span>
            </button>
          </div>
          <div className="canvas-chips">
            <button className={`chip ${tool === "wall" ? "on" : ""}`} onClick={() => setTool("wall")}>
              <BrickWall size={16} />
              <span>Add Line</span>
            </button>
            <button className={`chip ${tool === "label" ? "on" : ""}`} onClick={() => setTool("label")}>
              <TextCursorInput size={16} />
              <span>Add Label</span>
            </button>
            <button className={`chip ${snapEnabled ? "on" : ""}`} onClick={() => setSnapEnabled((value) => !value)}>
              <Grid3X3 size={16} />
              <span>Snap: {snapEnabled ? "6 in" : "Off"}</span>
            </button>
            <button className={`chip ${showUnderlay ? "on" : ""}`} onClick={() => setShowUnderlay((value) => !value)}>
              {showUnderlay ? <Eye size={16} /> : <EyeOff size={16} />}
              <span>Scan</span>
            </button>
            <button className="chip" onClick={resetPlan}>
              <RotateCcw size={16} />
              <span>Reset</span>
            </button>
          </div>
        </div>
        <div className="drawing-wrap">
          <svg
            ref={svgRef}
            className="plan-svg"
            viewBox={viewBox}
            onPointerDown={handleCanvasDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            role="img"
            aria-label="Editable floor plan"
          >
            <defs>
              <pattern id="smallGrid" width="1" height="1" patternUnits="userSpaceOnUse">
                <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#e8edf0" strokeWidth="0.035" />
              </pattern>
              <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
                <rect width="5" height="5" fill="url(#smallGrid)" />
                <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#d2dbe0" strokeWidth="0.08" />
              </pattern>
              <filter id="labelShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0.5" stdDeviation="0.25" floodColor="#ffffff" floodOpacity="0.95" />
              </filter>
              <pattern id="detailHatch" width="1.1" height="1.1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="1.1" stroke="#6f7d84" strokeWidth="0.08" />
              </pattern>
            </defs>
            <rect data-canvas="true" x="-50" y="-50" width="200" height="180" fill="#ffffff" />
            <rect data-canvas="true" x="-50" y="-50" width="200" height="180" fill="url(#grid)" />
            <image
              href={`${import.meta.env.BASE_URL}source-plan.png`}
              x={PLAN_META.sourceImage.x}
              y={PLAN_META.sourceImage.y}
              width={PLAN_META.sourceImage.width}
              height={PLAN_META.sourceImage.height}
              preserveAspectRatio="none"
              opacity={showUnderlay ? 0.22 : 0}
              pointerEvents="none"
            />
            <g className="fixed-details" pointerEvents="none">
              {fixedDetails.map((detail) => <FixedDetail key={detail.id} detail={detail} />)}
            </g>
            <g className="walls">
              {project.walls.map((wall) => (
                <WallSegment
                  key={wall.id}
                  wall={wall}
                  selected={selected.type === "wall" && selected.id === wall.id}
                  onPointerDown={handleWallPointerDown}
                  onEndpointDown={handleEndpointDown}
                />
              ))}
              {draftWall && (
                <g className="draft-wall">
                  <circle cx={draftWall.x} cy={draftWall.y} r="0.5" />
                  <line x1={draftWall.x} y1={draftWall.y} x2={draftEnd.x} y2={draftEnd.y} />
                  <text x={(draftWall.x + draftEnd.x) / 2} y={(draftWall.y + draftEnd.y) / 2 - 1.1} textAnchor="middle">
                    {formatFeet(Math.hypot(draftEnd.x - draftWall.x, draftEnd.y - draftWall.y))}
                  </text>
                </g>
              )}
            </g>
            <g className="openings" pointerEvents="none">
              {openings.map((opening) => <Opening key={opening.id} opening={opening} />)}
            </g>
            <g className="labels">
              {project.labels.map((label) => (
                <RoomLabel
                  key={label.id}
                  label={label}
                  metric={areaMetrics[label.id]}
                  selected={selected.type === "label" && selected.id === label.id}
                  onPointerDown={handleLabelPointerDown}
                  onDoubleClick={quickEditLabel}
                />
              ))}
            </g>
          </svg>
        </div>
        <div className="status-bar">
          <div>
            <span>Layer:</span>
            <strong>Base Plan</strong>
          </div>
          <div>
            <Move size={15} />
            <span>{instruction}</span>
          </div>
          <div>
            <span>{Math.round(zoom * 100)}%</span>
          </div>
        </div>
      </main>
      {showInspector ? (
        <Inspector
          wall={selectedWall}
          label={selectedLabel}
          labelMetric={selectedLabelMetric}
          project={project}
          areaMetrics={areaMetrics}
          selected={selected}
          onClose={() => setShowInspector(false)}
          onUpdateWall={updateWall}
          onUpdateLabel={updateLabel}
          onDelete={deleteSelection}
          onDuplicateLabel={(label) => {
            const id = `label-${Date.now()}`;
            commitProject(
              (current) => ({
                ...current,
                labels: [...current.labels, { ...label, id, x: label.x + 2, y: label.y + 2 }]
              }),
              "Label duplicated"
            );
            setSelected({ type: "label", id });
          }}
          onSelectLabel={(id) => setSelected({ type: "label", id })}
        />
      ) : (
        <button className="inspector-toggle" onClick={() => setShowInspector(true)} title="Open inspector">
          <PanelRightOpen size={20} />
        </button>
      )}
      <input ref={importRef} className="hidden-input" type="file" accept="application/json" onChange={importJson} />
    </div>
  );
}

function TopBar({
  zoom,
  setZoom,
  status,
  onExportSvg,
  onExportPng,
  onExportJson,
  onImport,
  onShare,
  onPrint,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  versionName,
  setVersionName,
  versions,
  onSaveVersion,
  onLoadVersion,
  onCopyVersionLink
}) {
  return (
    <header className="topbar">
      <div className="title-block">
        <h1>{PLAN_META.title}</h1>
        <span>{PLAN_META.address}</span>
      </div>
      <div className="topbar-actions">
        <button className="ghost-button" onClick={onUndo} disabled={!canUndo} title="Undo">
          <Undo2 size={18} />
        </button>
        <button className="ghost-button" onClick={onRedo} disabled={!canRedo} title="Redo">
          <Redo2 size={18} />
        </button>
        <div className="save-state">
          <CheckCircle2 size={16} />
          <span>{status}</span>
        </div>
        <div className="version-tools">
          <input
            aria-label="Version name"
            value={versionName}
            onChange={(event) => setVersionName(event.target.value)}
            placeholder="Version name"
          />
          <button onClick={onSaveVersion} title="Save named version">
            <Save size={16} />
            <span>Save</span>
          </button>
          <select aria-label="Load saved version" value="" onChange={(event) => onLoadVersion(event.target.value)}>
            <option value="" disabled>
              Load
            </option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.name}
              </option>
            ))}
          </select>
          <button onClick={onCopyVersionLink} title="Copy shareable version link">
            <Copy size={16} />
          </button>
        </div>
        <button className="action-button" onClick={onShare}>
          <Share2 size={17} />
          <span>Share</span>
        </button>
        <div className="export-group">
          <button onClick={onExportSvg} title="Export SVG">
            <Download size={16} />
            <span>SVG</span>
          </button>
          <button onClick={onExportPng} title="Export PNG">
            <ArrowDownToLine size={16} />
            <span>PNG</span>
          </button>
          <button onClick={onExportJson} title="Export JSON">
            <FileJson size={16} />
            <span>JSON</span>
          </button>
          <button onClick={onImport} title="Import JSON">
            <Import size={16} />
          </button>
        </div>
        <button className="ghost-button" onClick={onPrint} title="Print">
          <Printer size={18} />
        </button>
        <div className="zoom-control">
          <button onClick={() => setZoom((value) => clamp(value - 0.15, 0.65, 2.4))} title="Zoom out">
            <Minus size={15} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((value) => clamp(value + 0.15, 0.65, 2.4))} title="Zoom in">
            <Plus size={15} />
          </button>
        </div>
        <button className="ghost-button" title="Full screen" onClick={() => document.documentElement.requestFullscreen?.()}>
          <Maximize size={18} />
        </button>
      </div>
    </header>
  );
}

function PasswordGate({ onUnlock }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(passcode.trim()));
    const hash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (hash === PASSCODE_HASH) {
      sessionStorage.setItem(AUTH_KEY, "ok");
      onUnlock();
      return;
    }
    setBusy(false);
    setError("Incorrect password");
  };

  return (
    <main className="password-screen">
      <form className="password-panel" onSubmit={submit}>
        <Home size={26} />
        <h1>{PLAN_META.title}</h1>
        <p>Enter the project password to view and edit the plan.</p>
        <label>
          <span>Password</span>
          <input
            autoFocus
            inputMode="numeric"
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            placeholder="Enter password"
          />
        </label>
        {error && <strong className="password-error">{error}</strong>}
        <button type="submit" disabled={busy || !passcode.trim()}>
          <Unlock size={17} />
          <span>{busy ? "Checking..." : "Unlock Plans"}</span>
        </button>
      </form>
    </main>
  );
}

function splitDimensionText(dimensions) {
  const parts = dimensions.split(/\s+x\s+/);
  if (parts.length !== 2) return [dimensions];
  return [parts[0], `x ${parts[1]}`];
}

function WallSegment({ wall, selected, onPointerDown, onEndpointDown }) {
  const isExterior = wall.kind === "exterior";
  return (
    <g className={`wall-segment ${isExterior ? "exterior" : "interior"} ${selected ? "selected" : ""}`}>
      <line
        className="wall-hit"
        x1={wall.x1}
        y1={wall.y1}
        x2={wall.x2}
        y2={wall.y2}
        onPointerDown={(event) => onPointerDown(event, wall)}
      />
      <line
        className="wall-line"
        x1={wall.x1}
        y1={wall.y1}
        x2={wall.x2}
        y2={wall.y2}
        strokeWidth={wall.thickness}
        onPointerDown={(event) => onPointerDown(event, wall)}
      />
      {selected && (
        <>
          <g className="wall-measure" transform={`translate(${(wall.x1 + wall.x2) / 2} ${(wall.y1 + wall.y2) / 2 - 1.2})`}>
            <rect x="-3.25" y="-1.15" width="6.5" height="2.3" rx="0.45" />
            <text y="0.42" textAnchor="middle">
              {formatFeet(wallLength(wall))}
            </text>
          </g>
          <circle className="wall-handle" cx={wall.x1} cy={wall.y1} r="0.58" onPointerDown={(event) => onEndpointDown(event, wall, "start")} />
          <circle className="wall-handle" cx={wall.x2} cy={wall.y2} r="0.58" onPointerDown={(event) => onEndpointDown(event, wall, "end")} />
          {isExterior && (
            <g transform={`translate(${(wall.x1 + wall.x2) / 2} ${(wall.y1 + wall.y2) / 2})`} className="lock-tag">
              <rect x="-2.3" y="-1.25" width="4.6" height="2.5" rx="0.5" />
              <Lock size={1.4} x="-0.7" y="-0.7" />
            </g>
          )}
        </>
      )}
    </g>
  );
}

function RoomLabel({ label, metric, selected, onPointerDown, onDoubleClick }) {
  const areaText = selected && metric?.detectedArea
    ? formatArea(metric.detectedArea)
    : selected && metric?.printedArea
      ? `${formatArea(metric.printedArea)} printed`
      : "";
  const compactDims = metric?.printedArea && metric.printedArea < 65;
  const dimensionLines = compactDims ? splitDimensionText(label.dimensions) : [label.dimensions];
  const dimensionStep = compactDims ? 0.82 : 1.05;
  const dimensionLineHeight = dimensionLines.length > 1 ? dimensionStep : 0;
  const areaY = dimensionLines.length > 1 ? 3.45 : 2.75;
  const labelHeight = label.note
    ? 9.8 + dimensionLineHeight
    : areaText
      ? 7.2 + dimensionLineHeight
      : 5.6 + dimensionLineHeight;
  const textWidth = Math.max(
    label.name.length * (compactDims ? 0.54 : 0.72),
    ...dimensionLines.map((line) => line.length * (compactDims ? 0.36 : 0.48)),
    label.note ? Math.min(label.note.length * 0.22, compactDims ? 5.8 : 10.8) : 0,
    areaText ? areaText.length * 0.38 : 0
  );
  const labelWidth = clamp(textWidth + 1.4, compactDims ? 4.6 : 6.4, compactDims ? 7.2 : 13.8);
  const labelX = -labelWidth / 2;
  return (
    <g
      className={`room-label ${compactDims ? "compact" : ""} ${selected ? "selected" : ""}`}
      transform={`translate(${label.x} ${label.y})`}
      onPointerDown={(event) => onPointerDown(event, label)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onDoubleClick(label);
      }}
    >
      <rect className="label-hit" x={labelX} y="-2.35" width={labelWidth} height={labelHeight - 1.25} rx="0.35" />
      <text className="label-name" y="-0.75" textAnchor="middle">
        {label.name}
      </text>
      <text className="label-dims" y="1.2" textAnchor="middle">
        {dimensionLines.map((line, index) => (
          <tspan key={line} x="0" dy={index === 0 ? 0 : dimensionStep}>
            {line}
          </tspan>
        ))}
      </text>
      {areaText && (
        <text className="label-area" y={areaY} textAnchor="middle">
          {areaText}
        </text>
      )}
      {label.note && (
        <text className="label-note" y={areaText ? areaY + 1.8 : areaY + 0.3} textAnchor="middle">
          {label.note.length > 30 ? `${label.note.slice(0, 30)}...` : label.note}
        </text>
      )}
      {selected && <rect className="label-selected-box" x={labelX} y="-2.35" width={labelWidth} height={labelHeight - 1.25} rx="0.35" />}
    </g>
  );
}

function Opening({ opening }) {
  if (opening.kind === "opening") {
    return <line className="wall-opening-cut" x1={opening.x1} y1={opening.y1} x2={opening.x2} y2={opening.y2} />;
  }
  if (opening.kind === "window") {
    return (
      <g className="window-opening">
        <line className="window-cut" x1={opening.x1} y1={opening.y1} x2={opening.x2} y2={opening.y2} />
        <line x1={opening.x1} y1={opening.y1} x2={opening.x2} y2={opening.y2} />
        <line x1={opening.x1} y1={opening.y1 + 0.36} x2={opening.x2} y2={opening.y2 + 0.36} />
      </g>
    );
  }
  return <path className="door-opening" d={doorArcPath(opening)} />;
}

function FixedDetail({ detail }) {
  if (detail.kind === "hatchedRect") {
    return (
      <g className="hatched-detail">
        <rect x={detail.x} y={detail.y} width={detail.width} height={detail.height} />
        <rect className="hatch-fill" x={detail.x} y={detail.y} width={detail.width} height={detail.height} />
      </g>
    );
  }

  if (detail.kind === "dot") {
    return <circle className="reference-dot" cx={detail.x} cy={detail.y} r="0.18" />;
  }

  return null;
}

function Inspector({ wall, label, labelMetric, project, areaMetrics, onClose, onUpdateWall, onUpdateLabel, onDelete, onDuplicateLabel, onSelectLabel }) {
  const interiorCount = project.walls.filter((item) => item.kind === "interior").length;
  const enclosedAreaTotal = Object.values(areaMetrics).reduce((sum, metric) => sum + (metric.detectedArea || 0), 0);
  return (
    <aside className="inspector">
      <div className="inspector-header">
        <div>
          <p>Inspector</p>
          <h2>{wall ? "Wall" : label ? "Label" : "Project"}</h2>
        </div>
        <button className="icon-button" onClick={onClose} title="Close inspector">
          <PanelRightClose size={20} />
        </button>
      </div>
      {wall && (
        <div className="inspector-body">
          <div className="selection-title">
            {wall.kind === "exterior" ? <Lock size={18} /> : <Unlock size={18} />}
            <span>{wall.kind === "exterior" ? "Exterior wall locked" : "Interior wall editable"}</span>
          </div>
          <Field label="Length">
            <input value={formatFeet(wallLength(wall))} readOnly />
          </Field>
          <div className="field-grid">
            <Field label="Start X">
              <NumberInput value={wall.x1} disabled={wall.kind === "exterior"} onChange={(x1) => onUpdateWall(wall.id, { x1 })} />
            </Field>
            <Field label="Start Y">
              <NumberInput value={wall.y1} disabled={wall.kind === "exterior"} onChange={(y1) => onUpdateWall(wall.id, { y1 })} />
            </Field>
            <Field label="End X">
              <NumberInput value={wall.x2} disabled={wall.kind === "exterior"} onChange={(x2) => onUpdateWall(wall.id, { x2 })} />
            </Field>
            <Field label="End Y">
              <NumberInput value={wall.y2} disabled={wall.kind === "exterior"} onChange={(y2) => onUpdateWall(wall.id, { y2 })} />
            </Field>
          </div>
          <Field label="Thickness">
            <NumberInput value={wall.thickness} step={0.05} disabled={wall.kind === "exterior"} onChange={(thickness) => onUpdateWall(wall.id, { thickness })} />
          </Field>
          <div className="button-row">
            <NudgeButton disabled={wall.kind === "exterior"} icon={ArrowDownToLine} label="Up" onClick={() => onUpdateWall(wall.id, { y1: wall.y1 - 0.5, y2: wall.y2 - 0.5 })} />
            <NudgeButton disabled={wall.kind === "exterior"} icon={Move} label="Right" onClick={() => onUpdateWall(wall.id, { x1: wall.x1 + 0.5, x2: wall.x2 + 0.5 })} />
          </div>
          {wall.kind === "interior" && (
            <button className="danger-button" onClick={onDelete}>
              <Trash2 size={17} />
              <span>Delete Wall</span>
            </button>
          )}
        </div>
      )}
      {label && (
        <div className="inspector-body">
          <Field label="Room or Section">
            <input value={label.name} onChange={(event) => onUpdateLabel(label.id, { name: event.target.value })} />
          </Field>
          <Field label="Dimensions">
            <input value={label.dimensions} onChange={(event) => onUpdateLabel(label.id, { dimensions: event.target.value })} />
          </Field>
          <Field label="Wish List / Contractor Note">
            <textarea value={label.note} onChange={(event) => onUpdateLabel(label.id, { note: event.target.value })} rows={4} />
          </Field>
          <div className="area-readout">
            <div>
              <span>Printed area</span>
              <strong>{labelMetric?.printedArea ? formatArea(labelMetric.printedArea) : "Add dimensions"}</strong>
            </div>
            <div>
              <span>Closed-area estimate</span>
              <strong>{labelMetric?.detectedArea ? formatArea(labelMetric.detectedArea) : "Close walls to calculate"}</strong>
            </div>
          </div>
          <div className="field-grid">
            <Field label="X">
              <NumberInput value={label.x} onChange={(x) => onUpdateLabel(label.id, { x })} />
            </Field>
            <Field label="Y">
              <NumberInput value={label.y} onChange={(y) => onUpdateLabel(label.id, { y })} />
            </Field>
          </div>
          <div className="button-row">
            <button onClick={() => onDuplicateLabel(label)}>
              <Copy size={17} />
              <span>Duplicate</span>
            </button>
            <button onClick={onDelete}>
              <Trash2 size={17} />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}
      {!wall && !label && (
        <div className="inspector-body">
          <div className="project-card">
            <BringToFront size={20} />
            <div>
              <strong>{PLAN_META.title}</strong>
              <span>{PLAN_META.scaleNote}</span>
            </div>
          </div>
          <div className="metric-grid">
            <div>
              <strong>{project.labels.length}</strong>
              <span>Labels</span>
            </div>
            <div>
              <strong>{interiorCount}</strong>
              <span>Interior walls</span>
            </div>
            <div>
              <strong>{project.walls.length - interiorCount}</strong>
              <span>Locked exterior</span>
            </div>
            <div>
              <strong>{formatArea(enclosedAreaTotal) || "0 sq ft"}</strong>
              <span>Closed area</span>
            </div>
          </div>
          <div className="rooms-list">
            {project.labels.map((item) => (
              <button key={item.id} onClick={() => onSelectLabel(item.id)}>
                <LineChart size={14} />
                <span>{item.name}</span>
                <small>
                  {item.dimensions}
                  {areaMetrics[item.id]?.detectedArea ? ` · ${formatArea(areaMetrics[item.id].detectedArea)}` : ""}
                </small>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumberInput({ value, onChange, disabled = false, step = 0.5 }) {
  return (
    <input
      type="number"
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(cleanNumber(event.target.value))}
    />
  );
}

function NudgeButton({ icon: Icon, label, disabled, onClick }) {
  return (
    <button disabled={disabled} onClick={onClick}>
      <Icon size={17} />
      <span>{label}</span>
    </button>
  );
}

function renderOpeningMarkup(opening) {
  if (opening.kind === "opening") {
    return `<line x1="${opening.x1}" y1="${opening.y1}" x2="${opening.x2}" y2="${opening.y2}" stroke="#ffffff" stroke-width="0.82" stroke-linecap="square"/>`;
  }
  if (opening.kind === "window") {
    return `<g><line x1="${opening.x1}" y1="${opening.y1}" x2="${opening.x2}" y2="${opening.y2}" stroke="#ffffff" stroke-width="0.8" stroke-linecap="square"/><g stroke="#9aa7ad" stroke-width="0.16"><line x1="${opening.x1}" y1="${opening.y1}" x2="${opening.x2}" y2="${opening.y2}"/><line x1="${opening.x1}" y1="${opening.y1 + 0.36}" x2="${opening.x2}" y2="${opening.y2 + 0.36}"/></g></g>`;
  }
  return `<path d="${doorArcPath(opening)}" fill="none" stroke="#707d83" stroke-width="0.14"/>`;
}

function renderFixedDetailMarkup(detail) {
  if (detail.kind === "hatchedRect") {
    return `<g><rect x="${detail.x}" y="${detail.y}" width="${detail.width}" height="${detail.height}" fill="#ffffff" stroke="#6f7d84" stroke-width="0.12"/><path d="${diagonalHatchPath(detail)}" stroke="#6f7d84" stroke-width="0.08"/></g>`;
  }
  if (detail.kind === "dot") {
    return `<circle cx="${detail.x}" cy="${detail.y}" r="0.18" fill="#111518"/>`;
  }
  return "";
}

function diagonalHatchPath(detail) {
  const lines = [];
  for (let offset = -detail.height; offset < detail.width; offset += 1.2) {
    const x1 = detail.x + Math.max(0, offset);
    const y1 = detail.y + Math.max(0, -offset);
    const x2 = detail.x + Math.min(detail.width, offset + detail.height);
    const y2 = detail.y + Math.min(detail.height, detail.height - Math.max(0, offset + detail.height - detail.width));
    lines.push(`M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}`);
  }
  return lines.join(" ");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export default App;
