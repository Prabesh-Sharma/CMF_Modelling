import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import L from "leaflet";
import * as THREE from "three";
import type { GeoJsonObject } from "geojson";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const NEPAL_BOUNDS: L.LatLngBoundsExpression = [
  [26.35, 80.05],
  [30.45, 88.2],
];
const NEPAL_CENTER = { lat: 28.3949, lon: 84.124 };
const KATHMANDU_CENTER: [number, number] = [27.7172, 85.324];
const KATHMANDU_ZOOM = 12;
const INTRO_CENTER: [number, number] = [18.5, 76.5];
const INTRO_ZOOM = 4;
const KATHMANDU_ZOOM_START_MS = 2400;
const MAP_DELAY_MS = 4700;
const GLOBE_FOCUS_MS = 1700;

const TEXTURES = {
  day: "https://cdn.jsdelivr.net/gh/turban/webgl-earth@master/images/2_no_clouds_4k.jpg",
  bump: "https://cdn.jsdelivr.net/gh/turban/webgl-earth@master/images/elev_bump_4k.jpg",
  spec: "https://cdn.jsdelivr.net/gh/turban/webgl-earth@master/images/water_4k.png",
  clouds: "https://cdn.jsdelivr.net/gh/turban/webgl-earth@master/images/fair_clouds_4k.png",
  night: "https://cdn.jsdelivr.net/gh/turban/webgl-earth@master/images/5_night_4k.jpg",
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const degToRad = (deg: number) => (deg * Math.PI) / 180;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

interface LandingProps {
  onStart: () => void;
}

interface FocusState {
  startedAt: number;
  from: THREE.Quaternion;
  to: THREE.Quaternion;
  done: boolean;
}

function latLonToVector3(lat: number, lon: number, radius = 1) {
  const phi = degToRad(90 - lat);
  const theta = degToRad(lon + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function focusQuaternion(lat: number, lon: number) {
  const target = latLonToVector3(lat, lon, 1).normalize();
  return new THREE.Quaternion().setFromUnitVectors(target, new THREE.Vector3(0, 0, 1));
}

function makePulseTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 118);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.18, "rgba(255,45,85,0.92)");
  gradient.addColorStop(0.42, "rgba(255,45,85,0.20)");
  gradient.addColorStop(1, "rgba(255,45,85,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  return canvas;
}

function LandingGlobe({
  focusToken,
  onReady,
  onFocused,
}: {
  focusToken: number;
  onReady: () => void;
  onFocused: () => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<THREE.Group | null>(null);
  const cloudsRef = useRef<THREE.Mesh | null>(null);
  const markerRef = useRef<THREE.Sprite | null>(null);
  const animationRef = useRef<number | null>(null);
  const focusRef = useRef<FocusState | null>(null);
  const cameraDistanceRef = useRef(2.75);
  const pinchRef = useRef({ active: false, distance: 0, camera: 2.75 });
  const dragRef = useRef({
    active: false,
    lastX: 0,
    lastY: 0,
    velocityX: 0,
    velocityY: 0,
    autoRotate: true,
  });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 2.75);

    const globe = new THREE.Group();
    globe.quaternion.copy(focusQuaternion(12, 55));
    scene.add(globe);
    globeRef.current = globe;

    const textureLoader = new THREE.TextureLoader();
    textureLoader.crossOrigin = "anonymous";
    const dayTexture = textureLoader.load(TEXTURES.day);
    const bumpTexture = textureLoader.load(TEXTURES.bump);
    const specTexture = textureLoader.load(TEXTURES.spec);
    const cloudTexture = textureLoader.load(TEXTURES.clouds);
    const nightTexture = textureLoader.load(TEXTURES.night);
    [dayTexture, cloudTexture, nightTexture].forEach((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    });
    [bumpTexture, specTexture].forEach((texture) => {
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    });

    globe.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(1, 128, 128),
        new THREE.MeshStandardMaterial({
          map: dayTexture,
          bumpMap: bumpTexture,
          bumpScale: 0.045,
          metalnessMap: specTexture,
          roughness: 0.58,
          metalness: 0.16,
        }),
      ),
    );

    globe.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(1.004, 128, 128),
        new THREE.MeshBasicMaterial({
          map: nightTexture,
          transparent: true,
          opacity: 0.26,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );

    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.018, 128, 128),
      new THREE.MeshStandardMaterial({
        map: cloudTexture,
        transparent: true,
        opacity: 0.34,
        roughness: 1,
        metalness: 0,
        depthWrite: false,
      }),
    );
    globe.add(clouds);
    cloudsRef.current = clouds;

    const marker = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(makePulseTexture()),
        transparent: true,
        depthTest: false,
        opacity: 0.95,
      }),
    );
    marker.position.copy(latLonToVector3(NEPAL_CENTER.lat, NEPAL_CENTER.lon, 1.06));
    marker.scale.set(0.18, 0.18, 0.18);
    marker.renderOrder = 4;
    globe.add(marker);
    markerRef.current = marker;

    scene.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(1.065, 96, 96),
        new THREE.MeshBasicMaterial({
          color: 0x2d8dff,
          transparent: true,
          opacity: 0.16,
          side: THREE.BackSide,
          depthWrite: false,
        }),
      ),
    );

    const stars = new THREE.BufferGeometry();
    const starPositions: number[] = [];
    for (let i = 0; i < 2400; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 34 + Math.random() * 34;
      starPositions.push(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
      );
    }
    stars.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
    scene.add(
      new THREE.Points(
        stars,
        new THREE.PointsMaterial({
          color: 0xffffff,
          size: 0.075,
          transparent: true,
          opacity: 0.62,
          sizeAttenuation: true,
        }),
      ),
    );

    scene.add(new THREE.HemisphereLight(0x7aa8ff, 0x03050a, 0.72));
    scene.add(new THREE.AmbientLight(0x071123, 0.55));
    const sun = new THREE.DirectionalLight(0xfff6df, 1.35);
    sun.position.set(4, 2, 5);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x2f76ff, 1.05);
    rim.position.set(-5, 1.2, -2.4);
    scene.add(rim);

    function resize() {
      const size = mount.clientWidth || 500;
      renderer.setSize(size, size);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
    }

    function pointerXY(event: MouseEvent | TouchEvent) {
      const touch = "touches" in event ? event.touches[0] : undefined;
      return {
        x: "clientX" in event ? event.clientX : touch?.clientX ?? 0,
        y: "clientY" in event ? event.clientY : touch?.clientY ?? 0,
      };
    }

    function touchDistance(event: TouchEvent) {
      if (event.touches.length < 2) return 0;
      const a = event.touches[0];
      const b = event.touches[1];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }

    function setCameraDistance(next: number) {
      const distance = clamp(next, 2.0, 3.25);
      cameraDistanceRef.current = distance;
      camera.position.z = distance;
      if (markerRef.current) {
        markerRef.current.userData.baseScale = 0.17 + (3.25 - distance) * 0.018;
      }
    }

    function onPointerDown(event: Event) {
      if (focusRef.current) return;
      const pointerEvent = event as MouseEvent | TouchEvent;
      if ("touches" in pointerEvent && pointerEvent.touches.length > 1) {
        pinchRef.current = {
          active: true,
          distance: touchDistance(pointerEvent),
          camera: cameraDistanceRef.current,
        };
        dragRef.current.active = false;
        return;
      }
      const point = pointerXY(pointerEvent);
      dragRef.current.active = true;
      dragRef.current.autoRotate = false;
      dragRef.current.lastX = point.x;
      dragRef.current.lastY = point.y;
      dragRef.current.velocityX = 0;
      dragRef.current.velocityY = 0;
      mount.style.cursor = "grabbing";
    }

    function onPointerMove(event: Event) {
      const pointerEvent = event as MouseEvent | TouchEvent;
      if ("touches" in pointerEvent && pinchRef.current.active && pointerEvent.touches.length > 1) {
        const current = touchDistance(pointerEvent);
        if (current > 0) {
          const delta = (pinchRef.current.distance - current) * 0.006;
          setCameraDistance(pinchRef.current.camera + delta);
        }
        return;
      }
      if (!dragRef.current.active || !globeRef.current) return;
      const point = pointerXY(pointerEvent);
      const dx = point.x - dragRef.current.lastX;
      const dy = point.y - dragRef.current.lastY;
      dragRef.current.velocityX = dx * 0.0048;
      dragRef.current.velocityY = dy * 0.0048;
      globeRef.current.rotation.y += dragRef.current.velocityX;
      globeRef.current.rotation.x = clamp(
        globeRef.current.rotation.x + dragRef.current.velocityY,
        -1.2,
        1.2,
      );
      dragRef.current.lastX = point.x;
      dragRef.current.lastY = point.y;
    }

    function onPointerUp() {
      dragRef.current.active = false;
      pinchRef.current.active = false;
      mount.style.cursor = "grab";
    }

    function onWheel(event: WheelEvent) {
      if (focusRef.current) return;
      event.preventDefault();
      dragRef.current.autoRotate = false;
      setCameraDistance(cameraDistanceRef.current + event.deltaY * 0.0011);
    }

    resize();
    window.addEventListener("resize", resize);
    renderer.domElement.addEventListener("mousedown", onPointerDown);
    renderer.domElement.addEventListener("touchstart", onPointerDown, { passive: true });
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("touchmove", onPointerMove, { passive: true });
    window.addEventListener("mouseup", onPointerUp);
    window.addEventListener("touchend", onPointerUp);

    onReady();

    function tick(now = performance.now()) {
      animationRef.current = requestAnimationFrame(tick);
      const pulse = 0.5 + Math.sin(now * 0.005) * 0.5;

      if (focusRef.current && globeRef.current) {
        const elapsed = now - focusRef.current.startedAt;
        const t = easeInOut(clamp(elapsed / GLOBE_FOCUS_MS, 0, 1));
        globeRef.current.quaternion.slerpQuaternions(
          focusRef.current.from,
          focusRef.current.to,
          t,
        );
        camera.position.z = cameraDistanceRef.current - t * 0.38;
        if (t >= 1 && !focusRef.current.done) {
          focusRef.current.done = true;
          window.setTimeout(onFocused, 80);
        }
      } else if (globeRef.current) {
        if (!dragRef.current.active && dragRef.current.autoRotate) {
          globeRef.current.rotation.y += 0.0012;
        }
        if (!dragRef.current.active) {
          if (Math.abs(dragRef.current.velocityX) > 0.00004) {
            globeRef.current.rotation.y += dragRef.current.velocityX;
            dragRef.current.velocityX *= 0.935;
          }
          if (Math.abs(dragRef.current.velocityY) > 0.00004) {
            globeRef.current.rotation.x = clamp(
              globeRef.current.rotation.x + dragRef.current.velocityY,
              -1.2,
              1.2,
            );
            dragRef.current.velocityY *= 0.935;
          }
          if (
            Math.abs(dragRef.current.velocityX) < 0.00005 &&
            Math.abs(dragRef.current.velocityY) < 0.00005
          ) {
            dragRef.current.autoRotate = true;
          }
        }
      }

      if (cloudsRef.current) cloudsRef.current.rotation.y += 0.00018;
      if (markerRef.current) {
        const baseScale = markerRef.current.userData.baseScale ?? 0.17;
        const scale = baseScale + pulse * 0.055;
        markerRef.current.scale.set(scale, scale, scale);
        markerRef.current.material.opacity = 0.72 + pulse * 0.28;
      }

      renderer.render(scene, camera);
    }
    tick();

    return () => {
      if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("mousedown", onPointerDown);
      renderer.domElement.removeEventListener("touchstart", onPointerDown);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("touchmove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
      window.removeEventListener("touchend", onPointerUp);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose?.();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((material) => material.dispose?.());
        } else {
          mesh.material?.dispose?.();
        }
      });
      dayTexture.dispose();
      bumpTexture.dispose();
      specTexture.dispose();
      cloudTexture.dispose();
      nightTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [onFocused, onReady]);

  useEffect(() => {
    if (!focusToken || !globeRef.current) return;
    dragRef.current.active = false;
    dragRef.current.autoRotate = false;
    dragRef.current.velocityX = 0;
    dragRef.current.velocityY = 0;
    focusRef.current = {
      startedAt: performance.now(),
      from: globeRef.current.quaternion.clone(),
      to: focusQuaternion(NEPAL_CENTER.lat, NEPAL_CENTER.lon),
      done: false,
    };
  }, [focusToken]);

  return <div ref={mountRef} style={S.globeMount} />;
}

function getNepalBounds(geoJson: GeoJsonObject | null) {
  if (!geoJson) return L.latLngBounds(NEPAL_BOUNDS);
  const bounds = L.geoJSON(geoJson).getBounds();
  return bounds.isValid() ? bounds : L.latLngBounds(NEPAL_BOUNDS);
}

function MapAnimator({
  geoJson,
  launchToken,
  onCityZoom,
  onArrive,
}: {
  geoJson: GeoJsonObject | null;
  launchToken: number;
  onCityZoom: () => void;
  onArrive: () => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!launchToken) return undefined;

    const bounds = getNepalBounds(geoJson);
    map.invalidateSize();
    map.flyToBounds(bounds, {
      animate: true,
      duration: 2.1,
      easeLinearity: 0.18,
      maxZoom: 7,
      padding: [36, 36],
    });

    const cityTimer = window.setTimeout(() => {
      onCityZoom();
      map.flyTo(KATHMANDU_CENTER, KATHMANDU_ZOOM, {
        animate: true,
        duration: 1.8,
        easeLinearity: 0.18,
      });
    }, KATHMANDU_ZOOM_START_MS);

    const arriveTimer = window.setTimeout(onArrive, MAP_DELAY_MS);
    return () => {
      window.clearTimeout(cityTimer);
      window.clearTimeout(arriveTimer);
    };
  }, [geoJson, launchToken, map, onArrive, onCityZoom]);

  return null;
}

function LandingMap({
  launchToken,
  onCityZoom,
  onArrive,
  onReady,
}: {
  launchToken: number;
  onCityZoom: () => void;
  onArrive: () => void;
  onReady: () => void;
}) {
  const [geoJson, setGeoJson] = useState<GeoJsonObject | null>(null);
  useEffect(() => {
    let alive = true;

    fetch("/data/nepal.geojson")
      .then((res) => {
        if (!res.ok) throw new Error("Nepal GeoJSON unavailable");
        return res.json() as Promise<GeoJsonObject>;
      })
      .then((data) => {
        if (!alive) return;
        setGeoJson(data);
        onReady();
      })
      .catch(() => {
        if (!alive) return;
        onReady();
      });

    return () => {
      alive = false;
    };
  }, [onReady]);

  return (
    <MapContainer
      center={INTRO_CENTER}
      zoom={INTRO_ZOOM}
      zoomControl={false}
      attributionControl={false}
      dragging={false}
      doubleClickZoom={false}
      scrollWheelZoom={false}
      touchZoom={false}
      keyboard={false}
      style={S.map}
      worldCopyJump
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      {geoJson ? (
        <GeoJSON
          data={geoJson}
          className="nepal-boundary"
          style={{
            color: "#ff2d55",
            fillColor: "#ff2d55",
            fillOpacity: 0.28,
            opacity: 1,
            weight: 2.4,
          }}
        />
      ) : null}
      <MapAnimator
        geoJson={geoJson}
        launchToken={launchToken}
        onCityZoom={onCityZoom}
        onArrive={onArrive}
      />
    </MapContainer>
  );
}

export function Landing({ onStart }: LandingProps) {
  const [globeLoaded, setGlobeLoaded] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [phase, setPhase] = useState<"idle" | "globe-focusing" | "map-flying" | "entering">(
    "idle",
  );
  const [mapLabel, setMapLabel] = useState("Nepal");
  const [focusToken, setFocusToken] = useState(0);
  const [mapLaunchToken, setMapLaunchToken] = useState(0);
  const startRef = useRef(onStart);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  useEffect(() => {
    startRef.current = onStart;
  }, [onStart]);

  const handleGlobeReady = useCallback(() => {
    setGlobeLoaded(true);
  }, []);

  const handleMapReady = useCallback(() => {
    setMapLoaded(true);
  }, []);

  const handleGlobeFocused = useCallback(() => {
    setMapLabel("Nepal");
    setPhase("map-flying");
    setMapLaunchToken((token) => token + 1);
  }, []);

  const handleCityZoom = useCallback(() => {
    setMapLabel("Kathmandu");
  }, []);

  const handleArrive = useCallback(() => {
    setPhase("entering");
    window.setTimeout(() => startRef.current(), 260);
  }, []);

  function handleStart() {
    if (phase !== "idle") return;
    setPhase("globe-focusing");
    setFocusToken((token) => token + 1);
  }

  const isLaunching = phase !== "idle";
  const ready = globeLoaded || mapLoaded;
  const showMap = phase === "map-flying" || phase === "entering";

  return (
    <div className="landing-leaflet" style={{ ...S.root, ...(phase === "entering" ? S.rootOut : {}) }}>
      <div style={S.nebula1} />
      <div style={S.nebula2} />
      <div style={S.nebula3} />

      <div style={S.top}>
        <h1 style={S.title}>
          CMF<span style={S.accent}> modelling</span>
        </h1>
        <p style={S.sub}>
          Nepal road-safety decision support with crash risk maps, evidence-based
          countermeasures, and AI-guided interventions.
        </p>
      </div>

      <div style={S.stageWrap}>
        <div style={S.ring1} />
        <div style={S.ring2} />
        <div style={S.ring3} />
        <div style={S.stageClip}>
          {!ready ? (
            <div style={S.loader}>
              <div style={S.loaderRing} />
              <span style={S.loaderTxt}>Initialising Globe</span>
            </div>
          ) : null}
          <div
            style={{
              ...S.globeLayer,
              opacity: globeLoaded && !showMap ? 1 : 0,
              pointerEvents: showMap ? "none" : "auto",
            }}
          >
            <LandingGlobe
              focusToken={focusToken}
              onReady={handleGlobeReady}
              onFocused={handleGlobeFocused}
            />
          </div>
          <div
            style={{
              ...S.mapLayer,
              opacity: showMap ? 1 : 0,
              pointerEvents: showMap ? "auto" : "none",
            }}
          >
            <LandingMap
              launchToken={mapLaunchToken}
              onCityZoom={handleCityZoom}
              onArrive={handleArrive}
              onReady={handleMapReady}
            />
          </div>
          <div style={S.stageShade} />
          <div style={{ ...S.nepalTag, opacity: showMap ? 1 : 0 }}>{mapLabel}</div>
        </div>
        <div style={S.glow} />
      </div>

      <div style={S.bottom}>
        <button
          type="button"
          style={{ ...S.btn, ...(isLaunching ? S.btnOff : {}) }}
          onMouseEnter={(event) => {
            if (!isLaunching) {
              event.currentTarget.style.transform = "translateY(-4px) scale(1.05)";
              event.currentTarget.style.boxShadow = "0 10px 52px rgba(10,132,255,0.60)";
            }
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.transform = "";
            event.currentTarget.style.boxShadow = S.btn.boxShadow as string;
          }}
          onClick={handleStart}
          disabled={isLaunching}
        >
          {!isLaunching ? (
            <>
              Get Started
            </>
          ) : (
            <>
              <span style={S.bSpin} />
              &nbsp;Loading...
            </>
          )}
        </button>
        <p style={S.hint}>
          Drag the globe - then fly from Nepal to Kathmandu before entering the dashboard
        </p>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        .landing-leaflet .leaflet-container{background:#06111c;font-family:'DM Sans',sans-serif}
        .landing-leaflet .leaflet-tile{filter:saturate(.78) contrast(.94) brightness(.60)}
        .nepal-boundary{animation:landingBoundaryPulse 2.2s ease-in-out infinite}
        @keyframes landingPulse{0%,100%{opacity:1}50%{opacity:.15}}
        @keyframes landingFadein{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        @keyframes landingSpin{to{transform:rotate(360deg)}}
        @keyframes landingGlow{0%,100%{box-shadow:0 4px 32px rgba(10,132,255,.32)}50%{box-shadow:0 4px 56px rgba(10,132,255,.62)}}
        @keyframes landingFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
        @keyframes landingRing1{0%,100%{opacity:.20;transform:scale(1)}50%{opacity:.42;transform:scale(1.012)}}
        @keyframes landingRing2{0%,100%{opacity:.07;transform:scale(1)}50%{opacity:.16;transform:scale(1.018)}}
        @keyframes landingRing3{0%,100%{opacity:.025}50%{opacity:.08}}
        @keyframes landingBoundaryPulse{
          0%,100%{stroke-width:2.4;fill-opacity:.24;filter:drop-shadow(0 0 5px rgba(255,45,85,.55))}
          50%{stroke-width:4.2;fill-opacity:.38;filter:drop-shadow(0 0 14px rgba(255,45,85,.95))}
        }
      `}</style>
    </div>
  );
}

const G = "min(500px,84vw)";
const S = {
  root: {
    minHeight: "100vh",
    background: "#030509",
    color: "#e8eaf0",
    fontFamily: "'DM Sans', sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "28px 20px 24px",
    overflow: "hidden",
    position: "relative",
    userSelect: "none",
    transition: "opacity .28s ease, transform .28s ease",
    overscrollBehavior: "none",
  },
  rootOut: { opacity: 0, transform: "scale(1.015)" },
  nebula1: {
    position: "absolute",
    top: "-10%",
    left: "-12%",
    width: "50%",
    height: "50%",
    background: "radial-gradient(ellipse, rgba(0,30,100,.13) 0%, transparent 70%)",
    pointerEvents: "none",
    zIndex: 0,
    animation: "landingFloat 13s ease-in-out infinite",
  },
  nebula2: {
    position: "absolute",
    bottom: "-8%",
    right: "-10%",
    width: "42%",
    height: "42%",
    background: "radial-gradient(ellipse, rgba(0,15,65,.10) 0%, transparent 70%)",
    pointerEvents: "none",
    zIndex: 0,
    animation: "landingFloat 17s ease-in-out infinite 3s",
  },
  nebula3: {
    position: "absolute",
    top: "35%",
    right: "-5%",
    width: "25%",
    height: "30%",
    background: "radial-gradient(ellipse, rgba(0,55,170,.05) 0%, transparent 70%)",
    pointerEvents: "none",
    zIndex: 0,
  },
  top: { textAlign: "center", zIndex: 2, animation: "landingFadein .9s ease both" },
  title: {
    fontSize: "clamp(38px, 9vw, 58px)",
    fontWeight: 700,
    lineHeight: 1,
    color: "#fff",
    marginBottom: 10,
  },
  accent: { color: "#0a84ff" },
  sub: { fontSize: 12, color: "#555b6f", maxWidth: 390, margin: "0 auto", lineHeight: 1.9 },
  stageWrap: {
    position: "relative",
    width: G,
    height: G,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
    animation: "landingFloat 8s ease-in-out infinite",
  },
  ring1: {
    position: "absolute",
    width: "109%",
    height: "109%",
    borderRadius: "50%",
    border: "1.5px solid rgba(10,132,255,.22)",
    animation: "landingRing1 3.6s ease-in-out infinite",
    pointerEvents: "none",
  },
  ring2: {
    position: "absolute",
    width: "120%",
    height: "120%",
    borderRadius: "50%",
    border: "1px solid rgba(10,132,255,.07)",
    animation: "landingRing2 3.6s ease-in-out infinite .9s",
    pointerEvents: "none",
  },
  ring3: {
    position: "absolute",
    width: "132%",
    height: "132%",
    borderRadius: "50%",
    border: "1px solid rgba(10,132,255,.03)",
    animation: "landingRing3 3.6s ease-in-out infinite 1.8s",
    pointerEvents: "none",
  },
  stageClip: {
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    overflow: "hidden",
    position: "relative",
    background: "#06111c",
    boxShadow: "0 0 60px rgba(10,132,255,.08), inset 0 0 28px rgba(0,0,25,.45)",
  },
  globeLayer: { position: "absolute", inset: 0, transition: "opacity .7s ease", zIndex: 1 },
  mapLayer: { position: "absolute", inset: 0, transition: "opacity .7s ease", zIndex: 2 },
  globeMount: { width: "100%", height: "100%", cursor: "grab", touchAction: "none" },
  map: { width: "100%", height: "100%" },
  stageShade: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 3,
    boxShadow: "inset 0 0 46px rgba(0,0,0,.82), inset 0 0 120px rgba(3,5,9,.72)",
    background:
      "radial-gradient(circle at 50% 46%, rgba(255,255,255,.05), transparent 42%, rgba(0,0,0,.50) 100%)",
  },
  nepalTag: {
    position: "absolute",
    left: "57%",
    top: "42%",
    zIndex: 4,
    transform: "translate(-50%, -50%)",
    padding: "4px 10px",
    borderRadius: 16,
    background: "rgba(3,5,9,.72)",
    border: "1px solid rgba(255,45,85,.42)",
    color: "#fff",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    boxShadow: "0 0 18px rgba(255,45,85,.22)",
    pointerEvents: "none",
    transition: "opacity .5s ease",
  },
  loader: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    zIndex: 5,
  },
  loaderRing: {
    width: 40,
    height: 40,
    border: "1.5px solid rgba(10,132,255,.10)",
    borderTop: "1.5px solid #0a84ff",
    borderRadius: "50%",
    animation: "landingSpin .9s linear infinite",
  },
  loaderTxt: {
    fontSize: 10,
    color: "#6c738a",
    letterSpacing: "1.2px",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  glow: {
    position: "absolute",
    bottom: "-12%",
    width: "60%",
    height: "25%",
    background: "radial-gradient(ellipse, rgba(10,132,255,.09) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  bottom: { textAlign: "center", zIndex: 2, animation: "landingFadein 1s ease .5s both" },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 9,
    background: "linear-gradient(135deg, #0a84ff 0%, #0047cc 100%)",
    color: "#fff",
    border: "none",
    padding: "13px 44px",
    borderRadius: 50,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'DM Sans', sans-serif",
    marginBottom: 14,
    transition:
      "transform .22s cubic-bezier(.34,1.56,.64,1), box-shadow .22s ease",
    boxShadow: "0 4px 32px rgba(10,132,255,.35)",
    animation: "landingGlow 2.8s infinite",
    letterSpacing: "0.3px",
  },
  btnOff: { opacity: 0.68, cursor: "default", animation: "none" },
  bIcon: { fontSize: 11, opacity: 0.85 },
  bSpin: {
    display: "inline-block",
    width: 13,
    height: 13,
    border: "2px solid rgba(255,255,255,.22)",
    borderTop: "2px solid #fff",
    borderRadius: "50%",
    animation: "landingSpin .8s linear infinite",
  },
  hint: {
    fontSize: 10,
    color: "#383d4e",
    letterSpacing: "0.9px",
    textTransform: "uppercase",
    maxWidth: 460,
    margin: "0 auto",
  },
} satisfies Record<string, CSSProperties>;
