import { useState, useEffect, useMemo, useCallback, useRef } from "react";

// ── GitHub sync ──────────────────────────────────────────────────────────────
const GH_API = "https://api.github.com";
async function ghRequest(token, method, path, body) {
  const r = await fetch(`${GH_API}${path}`, {
    method,
    headers: { Authorization: `token ${token}`, "Content-Type": "application/json", Accept: "application/vnd.github+json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${r.statusText}`);
  return r.json();
}
async function loadFromGitHub(token, repo, path) {
  try {
    const data = await ghRequest(token, "GET", `/repos/${repo}/contents/${path}`);
    return { content: JSON.parse(atob(data.content)), sha: data.sha };
  } catch (e) {
    if (e.message.includes("404")) return { content: null, sha: null };
    throw e;
  }
}
async function saveToGitHub(token, repo, path, content, sha) {
  const body = {
    message: `Update contacts ${new Date().toISOString()}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
    ...(sha ? { sha } : {}),
  };
  return ghRequest(token, "PUT", `/repos/${repo}/contents/${path}`, body);
}

// ── Geocoding via Nominatim (free, no key needed) ────────────────────────────
async function geocode(location) {
  if (!location) return null;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`, {
      headers: { "Accept-Language": "en" }
    });
    const data = await r.json();
    if (data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
  } catch { return null; }
}

// ── Image compression ────────────────────────────────────────────────────────
function compressImage(file, maxDim = 300) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.src = url;
  });
}

// ── Utilities ────────────────────────────────────────────────────────────────
const COLORS = ["#38BDF8","#FB923C","#A78BFA","#34D399","#F472B6","#FBBF24","#60A5FA","#F87171"];
const avatarColor = (name) => { let h=0; for(let i=0;i<name.length;i++) h=name.charCodeAt(i)+((h<<5)-h); return COLORS[Math.abs(h)%COLORS.length]; };
const initials = (name) => name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
const today = () => new Date().toISOString().slice(0,10);
const fmtDate = (iso) => { if(!iso) return "—"; return new Date(iso+"T12:00:00").toLocaleDateString("en-CA",{month:"short",day:"numeric",year:"numeric"}); };
const daysSince = (iso) => { if(!iso) return null; return Math.floor((Date.now()-new Date(iso+"T12:00:00"))/86400000); };
const cadenceLabel = {7:"Weekly",14:"Biweekly",30:"Monthly",60:"Every 2 months",90:"Quarterly",180:"Every 6 months",365:"Yearly"};

// Birthday helpers
function daysUntilBirthday(bdayStr) {
  if (!bdayStr) return null;
  const now = new Date();
  const [,mm,dd] = bdayStr.split("-").map(Number);
  let next = new Date(now.getFullYear(), mm-1, dd);
  if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next.setFullYear(now.getFullYear()+1);
  return Math.ceil((next - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}
function fmtBirthday(bdayStr) {
  if (!bdayStr) return "—";
  const [yyyy,mm,dd] = bdayStr.split("-").map(Number);
  const d = new Date(yyyy||2000, mm-1, dd);
  const age = yyyy ? new Date().getFullYear() - yyyy : null;
  return d.toLocaleDateString("en-CA",{month:"long",day:"numeric"}) + (age ? ` (turns ${age})` : "");
}
function birthdayBadge(contact) {
  const days = daysUntilBirthday(contact.birthday);
  if (days === null) return null;
  if (days === 0) return { label:"🎂 Today!", color:"#F472B6" };
  if (days <= 7) return { label:`🎂 ${days}d`, color:"#F472B6" };
  if (days <= 30) return { label:`🎁 ${days}d`, color:"#A78BFA" };
  return null;
}
const cleanPhone = (p) => p?.replace(/\D/g,"")||"";
const linkedInUrl = (val) => {
  if(!val) return null;
  if(val.startsWith("http")) return val;
  return `https://linkedin.com/in/${val.replace(/^\/?(in\/)?/,"").replace(/\/$/,"")}`;
};

function touchStatus(c) {
  if(!c.cadence) return null;
  const ds=daysSince(c.lastContacted);
  if(ds===null) return "never";
  if(ds>=c.cadence) return "overdue";
  if(ds>=c.cadence*0.8) return "soon";
  return "ok";
}
const STATUS_COLOR={overdue:"#F87171",soon:"#FBBF24",ok:"#34D399",never:"#94A3B8"};
const STATUS_LABEL={overdue:"Overdue",soon:"Due soon",ok:"On track",never:"Never contacted"};
const INTERACTION_TYPES=["Meeting","Call","Email","Coffee","Event","LinkedIn","Text","Other"];

const SAMPLE=[
  {id:"1",name:"Sarah Chen",company:"Azure Dynamics",role:"Cloud Architect",email:"s.chen@azuredyn.com",phone:"519-555-0142",linkedin:"sarahchen-azure",location:"Windsor, Ontario",coords:null,photo:null,photoUrl:"",birthday:"1990-05-12",tags:["Azure","IT"],cadence:30,lastContacted:new Date(Date.now()-35*86400000).toISOString().slice(0,10),notes:"Met at Windsor Tech Meetup.",interactions:[{id:"i1",date:new Date(Date.now()-35*86400000).toISOString().slice(0,10),type:"Meeting",note:"Windsor Tech Meetup — discussed Navision migration."}]},
  {id:"2",name:"Mike Russo",company:"Logistics Partners Inc.",role:"Operations Manager",email:"mrusso@logpart.com",phone:"519-555-0287",linkedin:"",location:"Detroit, Michigan",coords:null,photo:null,photoUrl:"",birthday:"",tags:["Logistics","Operations"],cadence:60,lastContacted:new Date(Date.now()-20*86400000).toISOString().slice(0,10),notes:"Works with supply chain data.",interactions:[{id:"i2",date:new Date(Date.now()-20*86400000).toISOString().slice(0,10),type:"Call",note:"Quick call re: inbound logistics file spec."}]}
];

// ── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ contact, size=36, fontSize=13 }) {
  const src = contact.photo || contact.photoUrl;
  if (src) return <img src={src} alt={contact.name} style={{width:size,height:size,borderRadius:"50%",objectFit:"cover",flexShrink:0,border:"2px solid #1E293B"}} onError={e=>e.target.style.display="none"}/>;
  return <div style={{width:size,height:size,borderRadius:"50%",background:avatarColor(contact.name),display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Cabinet Grotesk',sans-serif",fontWeight:900,fontSize,color:"#0F172A",flexShrink:0}}>{initials(contact.name)}</div>;
}

// ── Action Buttons ───────────────────────────────────────────────────────────
function ActionButtons({ contact, onInteractionLog }) {
  const phone = cleanPhone(contact.phone);
  const li = linkedInUrl(contact.linkedin);
  return (
    <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"14px 0"}}>
      {phone&&<a href={`tel:${phone}`} style={{textDecoration:"none"}}><button className="btn action-btn" style={{background:"#34D39918",border:"1px solid #34D399",color:"#34D399"}}>📞 Call</button></a>}
      {phone&&<a href={`sms:${phone}`} style={{textDecoration:"none"}}><button className="btn action-btn" style={{background:"#38BDF818",border:"1px solid #38BDF8",color:"#38BDF8"}}>💬 Text</button></a>}
      {contact.email&&<a href={`mailto:${contact.email}`} style={{textDecoration:"none"}}><button className="btn action-btn" style={{background:"#A78BFA18",border:"1px solid #A78BFA",color:"#A78BFA"}}>✉️ Email</button></a>}
      {li&&<a href={li} target="_blank" rel="noopener noreferrer" style={{textDecoration:"none"}}><button className="btn action-btn" style={{background:"#0A66C218",border:"1px solid #0A66C2",color:"#60A5FA"}}><span style={{background:"#0A66C2",color:"#fff",fontWeight:700,fontSize:9,padding:"1px 4px",borderRadius:2,marginRight:4}}>in</span>LinkedIn</button></a>}
      <button className="btn action-btn" style={{background:"#FBBF2418",border:"1px solid #FBBF24",color:"#FBBF24"}} onClick={onInteractionLog}>📝 Log</button>
    </div>
  );
}

// ── Photo Picker ─────────────────────────────────────────────────────────────
function PhotoPicker({ photo, photoUrl, onPhoto, onUrl }) {
  const fileRef = useRef();
  const [tab, setTab] = useState("upload");
  const [uploading, setUploading] = useState(false);
  const previewSrc = photo || photoUrl;
  async function handleFile(e) {
    const file=e.target.files[0]; if(!file) return;
    setUploading(true); onPhoto(await compressImage(file,300)); setUploading(false);
  }
  return (
    <div>
      <span style={{fontSize:9,color:"#64748B",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:8,display:"block"}}>Photo</span>
      <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
        <div style={{width:68,height:68,borderRadius:"50%",background:"#0F172A",border:"2px dashed #334155",overflow:"hidden",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}} onClick={()=>{setTab("upload");setTimeout(()=>fileRef.current?.click(),50);}}>
          {previewSrc?<img src={previewSrc} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="preview"/>:<span style={{fontSize:22,color:"#334155"}}>📷</span>}
        </div>
        <div style={{flex:1}}>
          <div style={{display:"flex",marginBottom:8,borderRadius:3,overflow:"hidden",border:"1px solid #334155",width:"fit-content"}}>
            {[["upload","📁 Upload"],["url","🔗 URL"]].map(([t,l])=>(
              <button key={t} className="btn" style={{padding:"5px 12px",fontSize:9,letterSpacing:"0.08em",background:tab===t?"#38BDF8":"transparent",color:tab===t?"#0F172A":"#64748B",borderRadius:0}} onClick={()=>setTab(t)}>{l}</button>
            ))}
          </div>
          {tab==="upload"&&<div><input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleFile}/><button className="btn btn-ghost" style={{fontSize:10,width:"100%"}} onClick={()=>fileRef.current?.click()}>{uploading?"Compressing…":photo?"Change photo":"Choose from device"}</button>{photo&&<button className="btn" style={{fontSize:9,color:"#F87171",background:"none",padding:"4px 0",marginTop:4,display:"block"}} onClick={()=>onPhoto(null)}>Remove</button>}</div>}
          {tab==="url"&&<div><input type="text" value={photoUrl||""} onChange={e=>onUrl(e.target.value)} placeholder="https://…/photo.jpg"/>{photoUrl&&<button className="btn" style={{fontSize:9,color:"#F87171",background:"none",padding:"4px 0",marginTop:4,display:"block"}} onClick={()=>onUrl("")}>Clear</button>}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Map Page ─────────────────────────────────────────────────────────────────
function MapPage({ contacts, onSelectContact }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const [geocoding, setGeocoding] = useState(false);
  const [geocoded, setGeocoded] = useState([]);
  const [selected, setSelected] = useState(null);

  // Load Leaflet dynamically
  useEffect(() => {
    // Inject Leaflet CSS
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(link);
    }
    // Inject Leaflet JS
    if (!window.L) {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      script.onload = () => initMap();
      document.head.appendChild(script);
    } else {
      initMap();
    }
    return () => {
      if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }
    };
  }, []);

  function initMap() {
    if (!mapRef.current || mapInstanceRef.current) return;
    const map = window.L.map(mapRef.current, { zoomControl: true }).setView([43.5, -80], 5);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors", maxZoom: 18
    }).addTo(map);
    mapInstanceRef.current = map;
    geocodeAndPlot();
  }

  async function geocodeAndPlot() {
    if (!mapInstanceRef.current) return;
    setGeocoding(true);
    const results = [];

    // Clear old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    for (const c of contacts) {
      if (!c.location) continue;
      let coords = c.coords;
      if (!coords) coords = await geocode(c.location);
      if (!coords) continue;

      results.push({ ...c, coords });

      // Custom colored marker
      const color = avatarColor(c.name);
      const icon = window.L.divIcon({
        className: "",
        html: `<div style="width:36px;height:36px;border-radius:50%;background:${color};border:3px solid #0F172A;display:flex;align-items:center;justify-content:center;font-family:'Cabinet Grotesk',sans-serif;font-weight:900;font-size:12px;color:#0F172A;box-shadow:0 2px 8px #0007;cursor:pointer">${initials(c.name)}</div>`,
        iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20]
      });

      const marker = window.L.marker([coords.lat, coords.lng], { icon })
        .addTo(mapInstanceRef.current)
        .bindPopup(`
          <div style="font-family:'IBM Plex Mono',monospace;min-width:180px;">
            <div style="font-weight:600;font-size:13px;margin-bottom:2px;">${c.name}</div>
            <div style="font-size:10px;color:#64748B;margin-bottom:4px;">${c.role||""}${c.company?` · ${c.company}`:""}</div>
            <div style="font-size:10px;color:#94A3B8;">📍 ${c.location}</div>
            ${c.phone?`<div style="font-size:10px;margin-top:4px;"><a href="tel:${cleanPhone(c.phone)}" style="color:#34D399;text-decoration:none;">📞 ${c.phone}</a></div>`:""}
          </div>
        `);
      marker.on("click", () => setSelected(c.id));
      markersRef.current.push(marker);
    }

    setGeocoded(results);
    setGeocoding(false);

    // Fit map to markers
    if (results.length > 0 && mapInstanceRef.current) {
      const group = window.L.featureGroup(markersRef.current);
      mapInstanceRef.current.fitBounds(group.getBounds().pad(0.2));
    }
  }

  useEffect(() => {
    if (window.L && mapInstanceRef.current) geocodeAndPlot();
  }, [contacts]);

  const withLocation = contacts.filter(c => c.location);
  const withoutLocation = contacts.filter(c => !c.location);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 44px)"}}>
      {/* Map header */}
      <div style={{padding:"12px 20px",borderBottom:"1px solid #1E293B",display:"flex",alignItems:"center",gap:12,background:"#0F172A",flexShrink:0}}>
        <div style={{fontFamily:"'Cabinet Grotesk',sans-serif",fontSize:14,fontWeight:800,letterSpacing:"-0.01em"}}>
          CONTACT MAP
        </div>
        <div style={{fontSize:10,color:"#64748B"}}>
          {geocoding ? "Geocoding locations…" : `${geocoded.length} of ${withLocation.length} contacts mapped`}
        </div>
        {withoutLocation.length > 0 && (
          <div style={{fontSize:9,color:"#FBBF24",background:"#FBBF2418",border:"1px solid #FBBF24",padding:"2px 7px",borderRadius:2}}>
            {withoutLocation.length} contacts missing location
          </div>
        )}
        <div style={{flex:1}}/>
        <button className="btn btn-ghost" style={{fontSize:10}} onClick={geocodeAndPlot} disabled={geocoding}>
          {geocoding ? "Mapping…" : "↺ Refresh"}
        </button>
      </div>

      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        {/* Map */}
        <div ref={mapRef} style={{flex:1,background:"#1E293B"}}/>

        {/* Side panel - contact list */}
        <div style={{width:220,borderLeft:"1px solid #1E293B",overflowY:"auto",background:"#0F172A",flexShrink:0}}>
          <div style={{padding:"10px 12px",borderBottom:"1px solid #1E293B",fontSize:9,color:"#64748B",letterSpacing:"0.1em",textTransform:"uppercase"}}>Mapped Contacts</div>
          {geocoded.length === 0 && !geocoding && (
            <div style={{padding:"20px 12px",color:"#475569",fontSize:11,textAlign:"center",lineHeight:1.6}}>
              Add locations to your contacts to see them here.
            </div>
          )}
          {geocoded.map(c => (
            <div key={c.id} style={{padding:"10px 12px",borderBottom:"1px solid #1E293B",cursor:"pointer",background:selected===c.id?"#172033":"transparent",transition:"background 0.1s"}}
              onClick={() => {
                setSelected(c.id);
                if (mapInstanceRef.current && c.coords) {
                  mapInstanceRef.current.setView([c.coords.lat, c.coords.lng], 11);
                  markersRef.current.forEach(m => {
                    if (m.getLatLng().lat === c.coords.lat) m.openPopup();
                  });
                }
                onSelectContact(c.id);
              }}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <Avatar contact={c} size={28} fontSize={10}/>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:11,fontWeight:500,color:"#E2E8F0",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.name}</div>
                  <div style={{fontSize:9,color:"#64748B",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>📍 {c.location}</div>
                </div>
              </div>
            </div>
          ))}
          {withoutLocation.length > 0 && (
            <>
              <div style={{padding:"8px 12px",fontSize:9,color:"#475569",letterSpacing:"0.1em",textTransform:"uppercase",borderTop:"1px solid #1E293B",marginTop:4}}>No Location</div>
              {withoutLocation.map(c => (
                <div key={c.id} style={{padding:"8px 12px",borderBottom:"1px solid #1E293B",opacity:0.5}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <Avatar contact={c} size={24} fontSize={9}/>
                    <div style={{fontSize:10,color:"#64748B",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.name}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── PIN Lock Screen ──────────────────────────────────────────────────────────
const PIN_KEY = "dt_crm_pin";
const SESSION_KEY = "dt_crm_unlocked";

function PinScreen({ onUnlock }) {
  const [mode, setMode] = useState(() => localStorage.getItem(PIN_KEY) ? "enter" : "setup");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, [mode]);

  function triggerShake(msg) {
    setError(msg); setShake(true); setPin(""); setConfirm("");
    setTimeout(() => setShake(false), 500);
  }

  function handleSetup() {
    if (pin.length < 4) return setError("PIN must be at least 4 digits.");
    if (pin !== confirm) return triggerShake("PINs don't match. Try again.");
    localStorage.setItem(PIN_KEY, pin);
    sessionStorage.setItem(SESSION_KEY, "1");
    onUnlock();
  }

  function handleEnter() {
    if (pin === localStorage.getItem(PIN_KEY)) {
      sessionStorage.setItem(SESSION_KEY, "1");
      onUnlock();
    } else {
      triggerShake("Incorrect PIN.");
    }
  }

  function handleKey(e) { if (e.key === "Enter") mode === "setup" ? handleSetup() : handleEnter(); }

  // Dot display
  const dots = (val, max=8) => Array.from({length: max}, (_, i) => (
    <div key={i} style={{width:10,height:10,borderRadius:"50%",background:i<val.length?"#38BDF8":"#1E293B",border:"1px solid",borderColor:i<val.length?"#38BDF8":"#334155",transition:"background 0.15s"}}/>
  ));

  return (
    <div style={{fontFamily:"'IBM Plex Mono',monospace",background:"#0F172A",minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#E2E8F0"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Cabinet+Grotesk:wght@700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        input{font-family:'IBM Plex Mono',monospace;}
        .pin-btn{cursor:pointer;border:none;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.06em;transition:all 0.15s;border-radius:3px;}
        .pin-btn-primary{background:#38BDF8;color:#0F172A;padding:10px 28px;font-weight:600;width:100%;}
        .pin-btn-primary:hover{background:#7DD3FC;}
        @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}
        .shake{animation:shake 0.4s ease;}
      `}</style>

      <div style={{textAlign:"center",marginBottom:36}}>
        <div style={{fontFamily:"'Cabinet Grotesk',sans-serif",fontWeight:900,fontSize:28,letterSpacing:"-0.03em",marginBottom:4}}>
          DT <span style={{color:"#38BDF8"}}>NETWORK</span>
        </div>
        <div style={{fontSize:10,color:"#475569",letterSpacing:"0.15em",textTransform:"uppercase"}}>CRM · Private Access</div>
      </div>

      <div className={shake?"shake":""} style={{background:"#0D1829",border:"1px solid #1E293B",borderRadius:8,padding:"32px 36px",width:300,textAlign:"center"}}>
        <div style={{fontSize:12,color:"#64748B",marginBottom:24,letterSpacing:"0.05em"}}>
          {mode==="setup" ? "Create a PIN to secure your CRM" : "Enter your PIN to continue"}
        </div>

        {/* PIN dots */}
        <div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:20}}>
          {dots(pin)}
        </div>

        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pin}
          onChange={e=>{ setError(""); setPin(e.target.value.replace(/\D/g,"")); }}
          onKeyDown={handleKey}
          placeholder={mode==="setup"?"Choose PIN (4–8 digits)":"PIN"}
          style={{background:"#1E293B",border:"1px solid #334155",color:"#E2E8F0",borderRadius:3,padding:"9px 12px",width:"100%",fontSize:13,outline:"none",textAlign:"center",letterSpacing:"0.3em",marginBottom:mode==="setup"?12:16}}
        />

        {mode==="setup" && (
          <>
            <div style={{display:"flex",justifyContent:"center",gap:8,margin:"8px 0"}}>
              {dots(confirm)}
            </div>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={confirm}
              onChange={e=>{ setError(""); setConfirm(e.target.value.replace(/\D/g,"")); }}
              onKeyDown={handleKey}
              placeholder="Confirm PIN"
              style={{background:"#1E293B",border:"1px solid #334155",color:"#E2E8F0",borderRadius:3,padding:"9px 12px",width:"100%",fontSize:13,outline:"none",textAlign:"center",letterSpacing:"0.3em",marginBottom:16}}
            />
          </>
        )}

        {error && <div style={{fontSize:10,color:"#F87171",marginBottom:12,letterSpacing:"0.05em"}}>{error}</div>}

        <button className="pin-btn pin-btn-primary" onClick={mode==="setup" ? handleSetup : handleEnter}>
          {mode==="setup" ? "Set PIN & Enter" : "Unlock"}
        </button>

        {mode==="enter" && (
          <div style={{marginTop:16,fontSize:9,color:"#475569",letterSpacing:"0.08em"}}>
            Forgot PIN?{" "}
            <span style={{color:"#38BDF8",cursor:"pointer"}} onClick={()=>{ localStorage.removeItem(PIN_KEY); setMode("setup"); setPin(""); setConfirm(""); setError(""); }}>
              Reset
            </span>
          </div>
        )}
      </div>

      <div style={{marginTop:24,fontSize:9,color:"#334155",letterSpacing:"0.08em"}}>PIN stored locally · never transmitted</div>
    </div>
  );
}

// ── CSV Export ───────────────────────────────────────────────────────────────
function exportCSV(contacts) {
  const headers = ["name","company","role","email","phone","linkedin","location","birthday","tags","cadence","lastContacted","notes"];
  const rows = contacts.map(c => headers.map(h => {
    let val = h === "tags" ? (c.tags||[]).join(";") : (c[h]??"")+""
    return `"${val.replace(/"/g,'""')}"`
  }).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], {type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download="dt-network-crm-contacts.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ── CSV Import ───────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g,"").trim().toLowerCase());
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = [];
    let cur = "", inQ = false;
    for (let ch of lines[i]) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { vals.push(cur); cur = ""; continue; }
      cur += ch;
    }
    vals.push(cur);
    const row = {};
    headers.forEach((h,idx) => { row[h] = (vals[idx]||"").trim(); });
    results.push(row);
  }
  return results;
}

function csvRowToContact(row) {
  // Handles both our own export format and Google Contacts CSV
  const name = row["name"] || row["given name"] && row["family name"]
    ? `${row["given name"]||""} ${row["family name"]||""}`.trim()
    : row["given name"] || row["family name"] || row["display name"] || "";
  if (!name) return null;
  const phone = row["phone"] || row["mobile phone"] || row["home phone"] ||
    row["work phone"] || row["phone 1 - value"] || "";
  const email = row["email"] || row["e-mail address"] ||
    row["email 1 - value"] || row["e-mail 1 - value"] || "";
  const company = row["company"] || row["organization 1 - name"] || row["organization name"] || "";
  const role = row["role"] || row["title"] || row["job title"] || row["organization 1 - title"] || "";
  const notes = row["notes"] || row["note"] || "";
  const location = row["location"] || row["city"] || "";
  const linkedin = row["linkedin"] || "";
  const birthday = row["birthday"] || row["birthday date"] || "";
  const tagsRaw = row["tags"] || row["labels"] || row["group membership"] || "";
  const tags = tagsRaw ? tagsRaw.split(/[;,|]/).map(t=>t.replace(/\*/g,"").trim()).filter(Boolean) : [];
  const cadence = parseInt(row["cadence"]) || null;
  const lastContacted = row["lastcontacted"] || row["last contacted"] || null;
  return {
    id: Date.now().toString() + Math.random().toString(36).slice(2),
    name, company, role, email, phone, linkedin, location, birthday,
    tags, cadence, lastContacted, notes: notes,
    photo: null, photoUrl: "", coords: null, interactions: []
  };
}

// ── vCard Import ─────────────────────────────────────────────────────────────
function parseVCF(text) {
  const contacts = [];
  const cards = text.split(/BEGIN:VCARD/i).filter(c=>c.trim());
  for (const card of cards) {
    const lines = card.replace(/\r\n[\t ]/g," ").replace(/\r\n/g,"\n").split("\n");
    const get = (prefix) => {
      const line = lines.find(l=>l.toUpperCase().startsWith(prefix.toUpperCase()));
      return line ? line.split(":").slice(1).join(":").trim() : "";
    };
    const getAll = (prefix) => lines.filter(l=>l.toUpperCase().startsWith(prefix.toUpperCase()))
      .map(l=>l.split(":").slice(1).join(":").trim());

    const fn = get("FN");
    if (!fn) continue;

    // Phone — take first mobile or first available
    const telLines = lines.filter(l=>/^TEL/i.test(l));
    const mobileLine = telLines.find(l=>/CELL|MOBILE/i.test(l)) || telLines[0];
    const phone = mobileLine ? mobileLine.split(":").slice(1).join(":").trim() : "";

    // Email
    const emailLines = lines.filter(l=>/^EMAIL/i.test(l));
    const email = emailLines.length ? emailLines[0].split(":").slice(1).join(":").trim() : "";

    // Org
    const org = get("ORG").split(";")[0];
    const title = get("TITLE");

    // Address — get city
    const adrLine = lines.find(l=>/^ADR/i.test(l));
    let location = "";
    if (adrLine) {
      const parts = adrLine.split(":").slice(1).join(":").split(";");
      // ADR: PO;ext;street;city;region;postal;country
      location = [parts[3],parts[4],parts[6]].filter(Boolean).map(s=>s.trim()).filter(Boolean).join(", ");
    }

    // Birthday
    let birthday = "";
    const bdayRaw = get("BDAY");
    if (bdayRaw) {
      const digits = bdayRaw.replace(/\D/g,"");
      if (digits.length === 8) birthday = `${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}`;
      else if (digits.length === 4) birthday = `0000-${digits.slice(0,2)}-${digits.slice(2,4)}`;
    }

    // Note
    const note = get("NOTE").replace(/\\n/g,"\n").replace(/\\,/g,",");

    // URL — check for linkedin
    const urls = getAll("URL");
    const linkedin = (urls.find(u=>/linkedin/i.test(u))||"").replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//,"").replace(/\/$/,"");

    contacts.push({
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      name: fn, company: org, role: title, email, phone,
      linkedin, location, birthday, tags: [], cadence: null,
      lastContacted: null, notes: note,
      photo: null, photoUrl: "", coords: null, interactions: []
    });
  }
  return contacts;
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [unlocked, setUnlocked] = useState(()=>sessionStorage.getItem(SESSION_KEY)==="1");
  if (!unlocked) return <PinScreen onUnlock={()=>setUnlocked(true)}/>;

  const [contacts, setContacts] = useState(SAMPLE);
  const [ghToken, setGhToken] = useState(()=>localStorage.getItem("gh_token")||"");
  const [ghRepo, setGhRepo]   = useState(()=>localStorage.getItem("gh_repo")||"");
  const [ghPath]               = useState("network-crm/contacts.json");
  const [ghSha, setGhSha]     = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle");
  const [syncMsg, setSyncMsg]       = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [page, setPage]         = useState("crm"); // crm | map
  const [selected, setSelected] = useState(null);
  const [panel, setPanel]       = useState("list");
  const [search, setSearch]     = useState("");
  const [filterTag, setFilterTag]     = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);
  const [sortBy, setSortBy]     = useState("name");
  const blank = {name:"",company:"",role:"",email:"",phone:"",linkedin:"",location:"",birthday:"",tags:"",cadence:"30",notes:"",photo:null,photoUrl:""};
  const [newContact, setNewContact]     = useState(blank);
  const [newInteraction, setNewInteraction] = useState({date:today(),type:"Meeting",note:""});
  const [editingContact, setEditingContact] = useState(null);
  const [tokenInput, setTokenInput] = useState(ghToken);
  const [repoInput, setRepoInput]   = useState(ghRepo);
  const [importResult, setImportResult] = useState(null); // {added, skipped, errors}
  const csvRef = useRef();
  const vcfRef = useRef();

  useEffect(()=>{ if(ghToken&&ghRepo) loadContacts(); },[]);

  async function loadContacts() {
    if(!ghToken||!ghRepo) return;
    setSyncStatus("syncing"); setSyncMsg("Loading from GitHub…");
    try {
      const {content,sha}=await loadFromGitHub(ghToken,ghRepo,ghPath);
      if(content){setContacts(content);setGhSha(sha);}
      setSyncStatus("saved"); setSyncMsg("Synced ✓");
    } catch(e){ setSyncStatus("error"); setSyncMsg("Load failed: "+e.message); }
  }

  const save = useCallback(async(data)=>{
    if(!ghToken||!ghRepo) return;
    setSyncStatus("syncing"); setSyncMsg("Saving…");
    try {
      const res=await saveToGitHub(ghToken,ghRepo,ghPath,data,ghSha);
      setGhSha(res.content.sha);
      setSyncStatus("saved"); setSyncMsg("Saved to GitHub ✓");
    } catch(e){ setSyncStatus("error"); setSyncMsg("Save failed: "+e.message); }
  },[ghToken,ghRepo,ghSha]);

  function saveSettings() {
    localStorage.setItem("gh_token",tokenInput); localStorage.setItem("gh_repo",repoInput);
    setGhToken(tokenInput); setGhRepo(repoInput);
    setShowSettings(false); setTimeout(()=>loadContacts(),100);
  }

  function handleImport(text, parser) {
    const parsed = parser(text);
    const existing = new Set(contacts.map(c=>`${c.name.toLowerCase()}|${(c.email||"").toLowerCase()}`));
    const toAdd = [], skipped = [], errors = [];
    for (const raw of parsed) {
      try {
        const c = typeof raw === "object" && raw.name ? raw : csvRowToContact(raw);
        if (!c) { errors.push("Row skipped — no name"); continue; }
        const key = `${c.name.toLowerCase()}|${(c.email||"").toLowerCase()}`;
        if (existing.has(key)) { skipped.push(c.name); continue; }
        existing.add(key);
        toAdd.push(c);
      } catch(e) { errors.push(e.message); }
    }
    if (toAdd.length > 0) {
      const updated = [...contacts, ...toAdd];
      setContacts(updated); save(updated);
    }
    setImportResult({ added: toAdd.length, skipped: skipped.length, errors });
  }

  function handleCSVFile(e) {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const rows = parseCSV(ev.target.result);
      handleImport(rows, r => csvRowToContact(r));
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleVCFFile(e) {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => handleImport(parseVCF(ev.target.result), c => c);
    reader.readAsText(file);
    e.target.value = "";
  }

  function addContact() {
    if(!newContact.name.trim()) return;
    const c={...newContact,id:Date.now().toString(),tags:newContact.tags.split(",").map(t=>t.trim()).filter(Boolean),cadence:parseInt(newContact.cadence)||null,lastContacted:null,interactions:[],coords:null};
    const updated=[...contacts,c]; setContacts(updated); save(updated);
    setNewContact(blank); setSelected(c.id); setPanel("detail");
  }

  function saveEdit() {
    const updated=contacts.map(c=>c.id===editingContact.id
      ? {...editingContact,tags:typeof editingContact.tags==="string"?editingContact.tags.split(",").map(t=>t.trim()).filter(Boolean):editingContact.tags,cadence:parseInt(editingContact.cadence)||null,coords:editingContact.location!==contacts.find(x=>x.id===editingContact.id)?.location?null:editingContact.coords}
      : c);
    setContacts(updated); save(updated); setPanel("detail");
  }

  function deleteContact(id) {
    const updated=contacts.filter(c=>c.id!==id); setContacts(updated); save(updated);
    setSelected(null); setPanel("list");
  }

  function addInteraction() {
    if(!newInteraction.note.trim()) return;
    const interaction={id:Date.now().toString(),...newInteraction};
    const updated=contacts.map(c=>c.id===selected?{...c,interactions:[interaction,...c.interactions],lastContacted:newInteraction.date}:c);
    setContacts(updated); save(updated);
    setNewInteraction({date:today(),type:"Meeting",note:""}); setPanel("detail");
  }

  function deleteInteraction(cid,iid) {
    const updated=contacts.map(c=>{
      if(c.id!==cid) return c;
      const ints=c.interactions.filter(i=>i.id!==iid);
      return {...c,interactions:ints,lastContacted:ints.length>0?ints[0].date:null};
    });
    setContacts(updated); save(updated);
  }

  async function quickPhoto(file) {
    if(!file) return;
    const compressed=await compressImage(file,300);
    const updated=contacts.map(c=>c.id===selected?{...c,photo:compressed}:c);
    setContacts(updated); save(updated);
  }

  function openInteractionPanel() {
    setNewInteraction({date:today(),type:"Meeting",note:""}); setPanel("addInteraction");
  }

  const allTags=useMemo(()=>{const s=new Set();contacts.forEach(c=>c.tags?.forEach(t=>s.add(t)));return[...s].sort();},[contacts]);

  const filtered=useMemo(()=>{
    let list=contacts.filter(c=>{
      const q=search.toLowerCase();
      const ms=!q||c.name.toLowerCase().includes(q)||(c.company||"").toLowerCase().includes(q)||(c.role||"").toLowerCase().includes(q)||(c.location||"").toLowerCase().includes(q);
      const mt=!filterTag||c.tags?.includes(filterTag);
      const mst=!filterStatus||touchStatus(c)===filterStatus;
      return ms&&mt&&mst;
    });
    if(sortBy==="overdue") list=list.sort((a,b)=>{const o={overdue:0,never:1,soon:2,ok:3};return(o[touchStatus(a)]??4)-(o[touchStatus(b)]??4);});
    else if(sortBy==="lastContacted") list=list.sort((a,b)=>{if(!a.lastContacted)return 1;if(!b.lastContacted)return -1;return b.lastContacted.localeCompare(a.lastContacted);});
    else if(sortBy==="birthday") list=list.sort((a,b)=>{const da=daysUntilBirthday(a.birthday)??9999;const db=daysUntilBirthday(b.birthday)??9999;return da-db;});
    else list=list.sort((a,b)=>a.name.localeCompare(b.name));
    return list;
  },[contacts,search,filterTag,filterStatus,sortBy]);

  const overdueCount=useMemo(()=>contacts.filter(c=>["overdue","never"].includes(touchStatus(c))).length,[contacts]);
  const sel=contacts.find(c=>c.id===selected);
  const syncColor={idle:"#475569",syncing:"#FBBF24",saved:"#34D399",error:"#F87171"}[syncStatus];

  return (
    <div style={{fontFamily:"'IBM Plex Mono',monospace",background:"#0F172A",minHeight:"100vh",color:"#E2E8F0",display:"flex",flexDirection:"column"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Cabinet+Grotesk:wght@700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:#334155;}
        input,textarea,select{font-family:'IBM Plex Mono',monospace;}
        .btn{cursor:pointer;border:none;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.06em;transition:all 0.15s;border-radius:3px;}
        .btn-primary{background:#38BDF8;color:#0F172A;padding:8px 16px;font-weight:600;}
        .btn-primary:hover{background:#7DD3FC;}
        .btn-ghost{background:transparent;color:#64748B;padding:7px 13px;border:1px solid #1E293B;}
        .btn-ghost:hover{border-color:#475569;color:#E2E8F0;}
        .btn-danger{background:transparent;color:#F87171;padding:7px 13px;border:1px solid #1E293B;}
        .btn-danger:hover{background:#F8717120;border-color:#F87171;}
        .action-btn{padding:7px 13px;font-size:11px;font-weight:500;}
        .action-btn:hover{filter:brightness(1.2);}
        .fl{font-size:9px;color:#64748B;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:5px;display:block;}
        input[type=text],input[type=email],input[type=tel],input[type=password],input[type=url],textarea,select{background:#1E293B;border:1px solid #334155;color:#E2E8F0;border-radius:3px;padding:8px 11px;width:100%;font-size:12px;outline:none;transition:border 0.15s;}
        input:focus,textarea:focus,select:focus{border-color:#38BDF8;}
        textarea{resize:vertical;min-height:80px;}
        select option{background:#1E293B;}
        .tag{display:inline-block;padding:2px 7px;border-radius:2px;font-size:9px;letter-spacing:0.1em;font-weight:600;text-transform:uppercase;background:#1E293B;border:1px solid #334155;color:#64748B;cursor:pointer;transition:all 0.12s;}
        .tag:hover,.tag.active{background:#38BDF820;border-color:#38BDF8;color:#38BDF8;}
        .tag.s-overdue{background:#F8717118;border-color:#F87171;color:#F87171;}
        .tag.s-soon{background:#FBBF2418;border-color:#FBBF24;color:#FBBF24;}
        .tag.s-ok{background:#34D39918;border-color:#34D399;color:#34D399;}
        .crow{padding:10px 14px;border-bottom:1px solid #1E293B;cursor:pointer;display:flex;align-items:center;gap:10px;transition:background 0.1s;}
        .crow:hover{background:#1E293B;}
        .crow.active{background:#172033;border-left:2px solid #38BDF8;}
        .sidebar{width:280px;min-width:280px;border-right:1px solid #1E293B;display:flex;flex-direction:column;height:calc(100vh - 44px);}
        .main{flex:1;overflow-y:auto;padding:28px 32px;max-height:calc(100vh - 44px);}
        .icard{background:#1E293B;border:1px solid #0F172A;border-radius:4px;padding:12px 14px;margin-bottom:8px;}
        .itype{font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:600;padding:2px 6px;border-radius:2px;background:#0F172A;display:inline-block;margin-bottom:6px;color:#38BDF8;}
        .divider{border:none;border-top:1px solid #1E293B;margin:20px 0;}
        .mbg{position:fixed;inset:0;background:#00000099;display:flex;align-items:center;justify-content:center;z-index:100;}
        .modal{background:#0F172A;border:1px solid #334155;border-radius:6px;padding:28px;width:90%;max-width:460px;max-height:90vh;overflow-y:auto;}
        .photo-wrap:hover .photo-overlay{opacity:1!important;}
        .leaflet-popup-content-wrapper{background:#1E293B!important;border:1px solid #334155;color:#E2E8F0;border-radius:6px;}
        .leaflet-popup-tip{background:#1E293B!important;}
        .leaflet-popup-close-button{color:#64748B!important;}
        @media(max-width:700px){
          .layout{flex-direction:column!important;}
          .sidebar{width:100%;min-width:unset;height:auto;max-height:40vh;border-right:none;border-bottom:1px solid #1E293B;}
          .main{padding:16px;}
        }
      `}</style>

      {/* TOP BAR */}
      <div style={{height:44,background:"#0F172A",borderBottom:"1px solid #1E293B",display:"flex",alignItems:"center",padding:"0 16px",gap:12,flexShrink:0,zIndex:10}}>
        <div style={{fontFamily:"'Cabinet Grotesk',sans-serif",fontWeight:900,fontSize:17,letterSpacing:"-0.03em"}}>
          DT <span style={{color:"#38BDF8"}}>NETWORK</span><span style={{color:"#334155",fontSize:11,fontWeight:400,marginLeft:8,fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"0.05em"}}>CRM</span>
        </div>

        {/* Page tabs */}
        <div style={{display:"flex",gap:2,marginLeft:8,borderRadius:4,overflow:"hidden",border:"1px solid #1E293B"}}>
          {[["crm","👥 Contacts"],["map","🗺 Map"]].map(([p,l])=>(
            <button key={p} className="btn" style={{padding:"5px 14px",fontSize:10,background:page===p?"#1E293B":"transparent",color:page===p?"#E2E8F0":"#64748B",borderRadius:0,letterSpacing:"0.06em"}} onClick={()=>setPage(p)}>{l}</button>
          ))}
        </div>

        {overdueCount>0&&page==="crm"&&(
          <div style={{background:"#F8717120",border:"1px solid #F87171",color:"#F87171",fontSize:9,padding:"2px 7px",borderRadius:2,letterSpacing:"0.1em",cursor:"pointer"}}
            onClick={()=>setFilterStatus(filterStatus==="overdue"?null:"overdue")}>{overdueCount} OVERDUE</div>
        )}
        <div style={{flex:1}}/>
        <div style={{fontSize:9,color:syncColor,letterSpacing:"0.08em"}}>{syncMsg||(ghToken?"GitHub connected":"No sync — ⚙")}</div>
        <button className="btn btn-ghost" style={{fontSize:10}} onClick={()=>setShowSettings(true)}>⚙ Settings</button>
      </div>

      {/* MAP PAGE */}
      {page==="map" && (
        <MapPage contacts={contacts} onSelectContact={(id)=>{ setSelected(id); setPage("crm"); setPanel("detail"); }}/>
      )}

      {/* CRM PAGE */}
      {page==="crm" && (
        <div className="layout" style={{display:"flex",flex:1,overflow:"hidden"}}>

          {/* SIDEBAR */}
          <div className="sidebar">
            <div style={{padding:"14px 14px 10px",borderBottom:"1px solid #1E293B"}}>
              <button className="btn btn-primary" style={{width:"100%",marginBottom:10}} onClick={()=>setPanel("addContact")}>+ New Contact</button>
              <input type="text" placeholder="Search name, company, location…" value={search} onChange={e=>setSearch(e.target.value)} style={{marginBottom:8}}/>
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>
                {["overdue","soon","ok"].map(s=>(
                  <span key={s} className={`tag s-${s} ${filterStatus===s?"active":""}`} onClick={()=>setFilterStatus(filterStatus===s?null:s)}>{STATUS_LABEL[s]}</span>
                ))}
              </div>
              {allTags.length>0&&<div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:6}}>{allTags.map(t=><span key={t} className={`tag ${filterTag===t?"active":""}`} onClick={()=>setFilterTag(filterTag===t?null:t)}>{t}</span>)}</div>}
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{marginTop:4}}>
                <option value="name">Sort: Name</option>
                <option value="overdue">Sort: Overdue first</option>
                <option value="lastContacted">Sort: Recently contacted</option>
                <option value="birthday">Sort: Upcoming birthdays</option>
              </select>
            </div>
            <div style={{flex:1,overflowY:"auto"}}>
              {filtered.length===0&&<div style={{padding:"24px 16px",color:"#475569",fontSize:11,textAlign:"center"}}>No contacts found.</div>}
              {filtered.map(c=>{
                const st=touchStatus(c); const ds=daysSince(c.lastContacted);
                const bday=birthdayBadge(c);
                return(
                  <div key={c.id} className={`crow ${selected===c.id?"active":""}`} onClick={()=>{setSelected(c.id);setPanel("detail");}}>
                    <div style={{position:"relative",flexShrink:0}}>
                      <Avatar contact={c} size={36} fontSize={13}/>
                      {st&&<div style={{position:"absolute",bottom:0,right:0,width:9,height:9,borderRadius:"50%",background:STATUS_COLOR[st],border:"2px solid #0F172A"}}/>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:500,color:"#E2E8F0",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.name}</div>
                      <div style={{fontSize:10,color:"#64748B",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                        {c.location?`📍 ${c.location}`:(c.role||"")}
                        {c.linkedin&&<span style={{color:"#60A5FA",marginLeft:5}}>in</span>}
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3,flexShrink:0}}>
                      {bday&&<div style={{fontSize:9,color:bday.color,fontWeight:600}}>{bday.label}</div>}
                      <div style={{fontSize:9,color:st?STATUS_COLOR[st]:"#475569"}}>{ds!==null?`${ds}d`:"new"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{padding:"10px 14px",borderTop:"1px solid #1E293B",fontSize:9,color:"#475569",letterSpacing:"0.1em"}}>
              {contacts.length} CONTACTS · {overdueCount} NEED ATTENTION
            </div>
          </div>

          {/* MAIN PANEL */}
          <div className="main">

            {panel==="list"&&(
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"60%",color:"#334155",textAlign:"center"}}>
                <div style={{fontFamily:"'Cabinet Grotesk',sans-serif",fontSize:36,fontWeight:900,letterSpacing:"-0.04em",marginBottom:8}}>SELECT A CONTACT</div>
                <div style={{fontSize:10,color:"#475569",letterSpacing:"0.1em"}}>OR CREATE A NEW ONE</div>
                <button className="btn btn-ghost" style={{marginTop:20,fontSize:11}} onClick={()=>setPage("map")}>🗺 View Contact Map</button>
              </div>
            )}

            {/* DETAIL */}
            {panel==="detail"&&sel&&(()=>{
              const c=sel; const st=touchStatus(c); const ds=daysSince(c.lastContacted);
              return(
                <div style={{maxWidth:640}}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:16,marginBottom:4}}>
                    <label className="photo-wrap" style={{position:"relative",flexShrink:0,cursor:"pointer",borderRadius:"50%",display:"block",width:72,height:72}}>
                      <Avatar contact={c} size={72} fontSize={24}/>
                      <div className="photo-overlay" style={{position:"absolute",inset:0,borderRadius:"50%",background:"#00000065",display:"flex",alignItems:"center",justifyContent:"center",opacity:0,transition:"opacity 0.2s",flexDirection:"column",gap:2}}>
                        <span style={{fontSize:16}}>📷</span><span style={{fontSize:8,color:"#fff",letterSpacing:"0.05em"}}>CHANGE</span>
                      </div>
                      <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>quickPhoto(e.target.files[0])}/>
                    </label>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:"'Cabinet Grotesk',sans-serif",fontSize:22,fontWeight:900,letterSpacing:"-0.02em",color:"#E2E8F0"}}>{c.name}</div>
                      <div style={{fontSize:12,color:"#64748B",marginBottom:4}}>{c.role}{c.company?` · ${c.company}`:""}</div>
                      {c.location&&<div style={{fontSize:11,color:"#94A3B8",marginBottom:4,cursor:"pointer"}} onClick={()=>setPage("map")}>📍 {c.location}</div>}
                      {st&&(
                        <div style={{display:"inline-flex",alignItems:"center",gap:6,background:STATUS_COLOR[st]+"18",border:`1px solid ${STATUS_COLOR[st]}`,borderRadius:3,padding:"3px 8px"}}>
                          <div style={{width:6,height:6,borderRadius:"50%",background:STATUS_COLOR[st]}}/>
                          <span style={{fontSize:9,color:STATUS_COLOR[st],letterSpacing:"0.1em",fontWeight:600}}>{STATUS_LABEL[st]}{ds!==null?` · ${ds}d ago`:""}{c.cadence?` · ${cadenceLabel[c.cadence]||`Every ${c.cadence}d`}`:""}</span>
                        </div>
                      )}
                    </div>
                    <div style={{display:"flex",gap:8,flexShrink:0}}>
                      <button className="btn btn-ghost" onClick={()=>{setEditingContact({...c,tags:c.tags?.join(", ")||"",cadence:c.cadence?.toString()||"30"});setPanel("editContact");}}>Edit</button>
                      <button className="btn btn-danger" onClick={()=>deleteContact(c.id)}>Delete</button>
                    </div>
                  </div>

                  <ActionButtons contact={c} onInteractionLog={openInteractionPanel}/>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:16}}>
                    {c.email&&<div><span className="fl">Email</span><div style={{fontSize:12,color:"#CBD5E1"}}>{c.email}</div></div>}
                    {c.phone&&<div><span className="fl">Phone</span><div style={{fontSize:12,color:"#CBD5E1"}}>{c.phone}</div></div>}
                    {c.location&&<div><span className="fl">Location</span><div style={{fontSize:12,color:"#CBD5E1",cursor:"pointer"}} onClick={()=>setPage("map")}>📍 {c.location}</div></div>}
                    {c.linkedin&&(
                      <div><span className="fl">LinkedIn</span>
                        <a href={linkedInUrl(c.linkedin)} target="_blank" rel="noopener noreferrer" style={{fontSize:12,color:"#60A5FA",textDecoration:"none",display:"flex",alignItems:"center",gap:4}}>
                          <span style={{background:"#0A66C2",color:"#fff",fontWeight:700,fontSize:10,padding:"1px 5px",borderRadius:2}}>in</span>
                          {c.linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//,"").replace(/\/$/,"")}
                        </a>
                      </div>
                    )}
                    <div><span className="fl">Last contacted</span><div style={{fontSize:12,color:"#CBD5E1"}}>{fmtDate(c.lastContacted)}</div></div>
                    <div><span className="fl">Keep-in-touch</span><div style={{fontSize:12,color:"#CBD5E1"}}>{c.cadence?(cadenceLabel[c.cadence]||`Every ${c.cadence} days`):"Not set"}</div></div>
                    {c.birthday&&(
                      <div>
                        <span className="fl">Birthday</span>
                        <div style={{fontSize:12,color:"#CBD5E1",display:"flex",alignItems:"center",gap:8}}>
                          {fmtBirthday(c.birthday)}
                          {birthdayBadge(c)&&<span style={{fontSize:10,color:birthdayBadge(c).color,fontWeight:600}}>{birthdayBadge(c).label}</span>}
                        </div>
                      </div>
                    )}
                  </div>

                  {c.tags?.length>0&&<div style={{marginBottom:14}}><span className="fl">Tags</span><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{c.tags.map(t=><span key={t} className="tag">{t}</span>)}</div></div>}
                  {c.notes&&<div style={{marginBottom:14,background:"#1E293B",border:"1px solid #334155",borderRadius:4,padding:"12px 14px"}}><span className="fl">Notes</span><div style={{fontSize:12,color:"#CBD5E1",lineHeight:1.6}}>{c.notes}</div></div>}

                  <hr className="divider"/>

                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                    <div style={{fontFamily:"'Cabinet Grotesk',sans-serif",fontSize:14,fontWeight:800,color:"#E2E8F0",letterSpacing:"-0.01em"}}>
                      INTERACTIONS <span style={{color:"#475569",fontWeight:400,fontSize:11}}>({c.interactions?.length||0})</span>
                    </div>
                    <button className="btn btn-primary" onClick={openInteractionPanel}>+ Log</button>
                  </div>

                  {(!c.interactions||c.interactions.length===0)&&<div style={{color:"#475569",fontSize:11,padding:"16px 0"}}>No interactions logged yet.</div>}
                  {c.interactions?.map(i=>(
                    <div key={i.id} className="icard">
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          <span className="itype">{i.type}</span>
                          <span style={{fontSize:9,color:"#64748B",letterSpacing:"0.08em"}}>{fmtDate(i.date)}</span>
                        </div>
                        <button className="btn" style={{background:"none",color:"#64748B",fontSize:16,padding:0,lineHeight:1}} onClick={()=>deleteInteraction(c.id,i.id)}>×</button>
                      </div>
                      <div style={{fontSize:12,color:"#CBD5E1",lineHeight:1.6}}>{i.note}</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* ADD INTERACTION */}
            {panel==="addInteraction"&&sel&&(
              <div style={{maxWidth:480}}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
                  <Avatar contact={sel} size={40} fontSize={14}/>
                  <div>
                    <div style={{fontFamily:"'Cabinet Grotesk',sans-serif",fontSize:16,fontWeight:900,letterSpacing:"-0.02em"}}>Log Interaction</div>
                    <div style={{fontSize:11,color:"#64748B"}}>with {sel.name}</div>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
                  <div><span className="fl">Date</span><input type="text" value={newInteraction.date} onChange={e=>setNewInteraction(p=>({...p,date:e.target.value}))} placeholder="YYYY-MM-DD"/></div>
                  <div><span className="fl">Type</span><select value={newInteraction.type} onChange={e=>setNewInteraction(p=>({...p,type:e.target.value}))}>{INTERACTION_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
                </div>
                <div style={{marginBottom:18}}><span className="fl">Notes</span><textarea value={newInteraction.note} onChange={e=>setNewInteraction(p=>({...p,note:e.target.value}))} placeholder="What did you discuss? Key takeaways, follow-ups…" autoFocus/></div>
                <div style={{display:"flex",gap:10}}>
                  <button className="btn btn-primary" onClick={addInteraction}>Save</button>
                  <button className="btn btn-ghost" onClick={()=>setPanel("detail")}>Cancel</button>
                </div>
              </div>
            )}

            {/* ADD / EDIT CONTACT */}
            {(panel==="addContact"||panel==="editContact")&&(()=>{
              const isEdit=panel==="editContact";
              const data=isEdit?editingContact:newContact;
              const set=isEdit?setEditingContact:setNewContact;
              return(
                <div style={{maxWidth:540}}>
                  <div style={{fontFamily:"'Cabinet Grotesk',sans-serif",fontSize:18,fontWeight:900,marginBottom:22,letterSpacing:"-0.02em"}}>{isEdit?"Edit Contact":"New Contact"}</div>

                  <div style={{marginBottom:22,background:"#1E293B",border:"1px solid #334155",borderRadius:4,padding:"16px"}}>
                    <PhotoPicker photo={data.photo} photoUrl={data.photoUrl} onPhoto={v=>set(p=>({...p,photo:v}))} onUrl={v=>set(p=>({...p,photoUrl:v}))}/>
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
                    {[["Name *","name","text"],["Company","company","text"],["Role","role","text"],["Email","email","email"],["Phone","phone","tel"]].map(([label,field,type])=>(
                      <div key={field} style={{gridColumn:field==="name"?"1/-1":"auto"}}>
                        <span className="fl">{label}</span>
                        <input type={type} value={data[field]||""} onChange={e=>set(p=>({...p,[field]:e.target.value}))}/>
                      </div>
                    ))}
                  </div>

                  {/* Location + LinkedIn */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
                    <div>
                      <span className="fl">Location</span>
                      <input type="text" value={data.location||""} onChange={e=>set(p=>({...p,location:e.target.value,coords:null}))} placeholder="Windsor, Ontario"/>
                      <div style={{fontSize:9,color:"#475569",marginTop:3}}>Used to plot on the map</div>
                    </div>
                    <div>
                      <span className="fl">LinkedIn</span>
                      <div style={{position:"relative"}}>
                        <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",background:"#0A66C2",color:"#fff",fontWeight:700,fontSize:10,padding:"1px 5px",borderRadius:2,pointerEvents:"none"}}>in</span>
                        <input type="text" value={data.linkedin||""} onChange={e=>set(p=>({...p,linkedin:e.target.value}))} placeholder="username or full URL" style={{paddingLeft:44}}/>
                      </div>
                    </div>
                  </div>

                  {/* Birthday */}
                  <div style={{marginBottom:14}}>
                    <span className="fl">Birthday</span>
                    <input type="text" value={data.birthday||""} onChange={e=>set(p=>({...p,birthday:e.target.value}))} placeholder="YYYY-MM-DD  (year optional, e.g. 1985-06-15 or 0000-06-15)"/>
                    {data.birthday&&<div style={{fontSize:9,color:"#38BDF8",marginTop:3}}>{fmtBirthday(data.birthday)} · {daysUntilBirthday(data.birthday)} days away</div>}
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
                    <div>
                      <span className="fl">Keep-in-touch cadence</span>
                      <select value={data.cadence||"30"} onChange={e=>set(p=>({...p,cadence:e.target.value}))}>
                        <option value="">None</option>
                        {Object.entries(cadenceLabel).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <span className="fl">Tags (comma separated)</span>
                      <input type="text" value={typeof data.tags==="string"?data.tags:data.tags?.join(", ")||""} onChange={e=>set(p=>({...p,tags:e.target.value}))} placeholder="Azure, IT, Logistics"/>
                    </div>
                  </div>
                  <div style={{marginBottom:20}}><span className="fl">Notes</span><textarea value={data.notes||""} onChange={e=>set(p=>({...p,notes:e.target.value}))} placeholder="Background, how you met, key interests…"/></div>
                  <div style={{display:"flex",gap:10}}>
                    <button className="btn btn-primary" onClick={isEdit?saveEdit:addContact}>{isEdit?"Save Changes":"Create Contact"}</button>
                    <button className="btn btn-ghost" onClick={()=>setPanel(selected?"detail":"list")}>Cancel</button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {showSettings&&(
        <div className="mbg" onClick={()=>{setShowSettings(false);setImportResult(null);}}>
          <div className="modal" onClick={e=>e.stopPropagation()}>

            {/* GitHub Sync */}
            <div style={{fontFamily:"'Cabinet Grotesk',sans-serif",fontSize:16,fontWeight:900,marginBottom:4,letterSpacing:"-0.02em"}}>GitHub Sync</div>
            <div style={{fontSize:10,color:"#64748B",marginBottom:16,lineHeight:1.6}}>
              All data stored in one JSON file in your private repo.<br/>
              Token needs <strong style={{color:"#CBD5E1"}}>repo</strong> scope — create at github.com → Settings → Developer settings → Personal access tokens.
            </div>
            <div style={{marginBottom:12}}><span className="fl">Personal Access Token</span><input type="password" value={tokenInput} onChange={e=>setTokenInput(e.target.value)} placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"/></div>
            <div style={{marginBottom:12}}><span className="fl">Repository (owner/repo)</span><input type="text" value={repoInput} onChange={e=>setRepoInput(e.target.value)} placeholder="yourusername/my-private-repo"/></div>
            <div style={{fontSize:9,color:"#475569",marginBottom:12,lineHeight:1.7,background:"#1E293B",padding:"10px 12px",borderRadius:3}}>
              Saves to: <span style={{color:"#38BDF8"}}>{repoInput||"your-repo"}/network-crm/contacts.json</span>
            </div>
            <div style={{display:"flex",gap:10,marginBottom:24}}>
              <button className="btn btn-primary" onClick={saveSettings}>Save & Connect</button>
              <button className="btn btn-ghost" onClick={()=>{setShowSettings(false);setImportResult(null);}}>Cancel</button>
            </div>

            {/* Divider */}
            <div style={{borderTop:"1px solid #1E293B",marginBottom:20}}/>

            {/* Export */}
            <div style={{fontFamily:"'Cabinet Grotesk',sans-serif",fontSize:14,fontWeight:800,marginBottom:8,letterSpacing:"-0.01em"}}>Export</div>
            <div style={{fontSize:10,color:"#64748B",marginBottom:12,lineHeight:1.6}}>
              Download all contacts as a CSV file. Opens in Excel, Google Sheets, or Numbers.
            </div>
            <button className="btn btn-ghost" style={{width:"100%",marginBottom:4,fontSize:11}} onClick={()=>exportCSV(contacts)}>
              ⬇ Export {contacts.length} contacts to CSV
            </button>

            {/* Divider */}
            <div style={{borderTop:"1px solid #1E293B",margin:"20px 0"}}/>

            {/* Import */}
            <div style={{fontFamily:"'Cabinet Grotesk',sans-serif",fontSize:14,fontWeight:800,marginBottom:8,letterSpacing:"-0.01em"}}>Import Contacts</div>
            <div style={{fontSize:10,color:"#64748B",marginBottom:14,lineHeight:1.6}}>
              Duplicate contacts (matching name + email) are skipped automatically.
            </div>

            {/* CSV Import */}
            <div style={{marginBottom:12}}>
              <span className="fl">CSV File</span>
              <div style={{fontSize:9,color:"#475569",marginBottom:6,lineHeight:1.6}}>
                Supports: DT Network CRM export, Google Contacts CSV (File → Export → Google CSV)
              </div>
              <input ref={csvRef} type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={handleCSVFile}/>
              <button className="btn btn-ghost" style={{width:"100%",fontSize:11}} onClick={()=>csvRef.current?.click()}>
                ⬆ Import from CSV
              </button>
            </div>

            {/* vCard Import */}
            <div style={{marginBottom:16}}>
              <span className="fl">vCard / .vcf File</span>
              <div style={{fontSize:9,color:"#475569",marginBottom:6,lineHeight:1.6}}>
                iPhone: icloud.com → Contacts → Select All → Export vCard<br/>
                Google: contacts.google.com → Export → vCard (.vcf)
              </div>
              <input ref={vcfRef} type="file" accept=".vcf,.vcard,text/vcard" style={{display:"none"}} onChange={handleVCFFile}/>
              <button className="btn btn-ghost" style={{width:"100%",fontSize:11}} onClick={()=>vcfRef.current?.click()}>
                ⬆ Import from vCard (.vcf)
              </button>
            </div>

            {/* Import Result */}
            {importResult&&(
              <div style={{background: importResult.added>0?"#34D39918":"#F8717118", border:`1px solid ${importResult.added>0?"#34D399":"#F87171"}`, borderRadius:4, padding:"12px 14px", fontSize:11}}>
                {importResult.added>0&&<div style={{color:"#34D399",fontWeight:600,marginBottom:4}}>✓ {importResult.added} contact{importResult.added!==1?"s":""} imported successfully</div>}
                {importResult.skipped>0&&<div style={{color:"#FBBF24",marginBottom:4}}>⟳ {importResult.skipped} duplicate{importResult.skipped!==1?"s":""} skipped</div>}
                {importResult.errors.length>0&&<div style={{color:"#F87171"}}>⚠ {importResult.errors.length} row{importResult.errors.length!==1?"s":""} could not be parsed</div>}
                {importResult.added===0&&importResult.skipped===0&&<div style={{color:"#F87171"}}>No contacts found in file.</div>}
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
