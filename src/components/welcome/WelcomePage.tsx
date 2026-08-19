import { useEffect, useRef } from "react"
import { ArrowRight, Factory } from "lucide-react"
import { Button } from "@/components/ui/button"
import prismLogoRound from "@/assets/prism-logo-round.png"

function WelcomeShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext("webgl")
    if (!gl) return

    const vertexSource = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      void main() {
        v_texCoord = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `
    const fragmentSource = `
      precision highp float;
      uniform float u_time;
      uniform vec2 u_resolution;
      uniform vec2 u_mouse;
      varying vec2 v_texCoord;

      vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod(i, 289.0);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m;
        m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      void main() {
        vec2 uv = v_texCoord;
        vec2 center = u_mouse / u_resolution;
        float noise1 = snoise(uv * 1.2 + u_time * 0.04);
        float noise2 = snoise(uv * 2.0 - u_time * 0.06);
        vec3 deepBg = vec3(0.035, 0.043, 0.055);
        vec3 primaryViolet = vec3(0.545, 0.361, 0.965);
        vec3 indigo = vec3(0.388, 0.4, 0.945);
        vec3 accentCyan = vec3(0.22, 0.741, 0.973);
        float mask1 = smoothstep(-0.2, 0.8, noise1);
        float mask2 = smoothstep(-0.5, 0.5, noise2);
        float dist = distance(uv, center);
        float mousePulse = smoothstep(0.5, 0.0, dist) * 0.2;
        vec3 color = mix(deepBg, primaryViolet, mask1 * 0.35);
        color = mix(color, indigo, mask2 * 0.25);
        color = mix(color, accentCyan, (mask1 * mask2) * 0.1);
        float refraction = pow(abs(noise1 + noise2), 5.0) * 0.12;
        color += refraction * accentCyan;
        color += mousePulse * primaryViolet;
        gl_FragColor = vec4(color, 1.0);
      }
    `
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader)
        return null
      }
      return shader
    }
    const vertexShader = compile(gl.VERTEX_SHADER, vertexSource)
    const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource)
    if (!vertexShader || !fragmentShader) return
    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, "a_position")
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const timeUniform = gl.getUniformLocation(program, "u_time")
    const resolutionUniform = gl.getUniformLocation(program, "u_resolution")
    const mouseUniform = gl.getUniformLocation(program, "u_mouse")
    let mouseX = window.innerWidth / 2
    let mouseY = window.innerHeight / 2
    let frame = 0

    const syncSize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    const trackMouse = (event: MouseEvent) => {
      mouseX = event.clientX
      mouseY = canvas.height - event.clientY
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const render = (timestamp: number) => {
      gl.viewport(0, 0, canvas.width, canvas.height)
      if (timeUniform) gl.uniform1f(timeUniform, timestamp * .001)
      if (resolutionUniform) gl.uniform2f(resolutionUniform, canvas.width, canvas.height)
      if (mouseUniform) gl.uniform2f(mouseUniform, mouseX, mouseY)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      if (!reduceMotion) frame = requestAnimationFrame(render)
    }
    syncSize()
    window.addEventListener("resize", syncSize)
    window.addEventListener("mousemove", trackMouse)
    frame = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", syncSize)
      window.removeEventListener("mousemove", trackMouse)
      if (buffer) gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
    }
  }, [])

  return <canvas ref={canvasRef} className="welcome-shader" aria-hidden="true" />
}

export function WelcomePage({ onExplore }: { onExplore: () => void }) {
  return <section className="welcome-page" aria-labelledby="welcome-title">
    <WelcomeShader />
    <div className="welcome-aurora" aria-hidden="true" />
    <div className="welcome-panel">
      <div className="welcome-panel-glow" aria-hidden="true" />
      <div className="welcome-copy">
        <div>
          <div className="welcome-brand-mark" aria-hidden="true"><img src={prismLogoRound} alt="" /></div>
          <h1 id="welcome-title">Welcome to the Future of LCA</h1>
          <p>A precision-engineered workspace for product graph modeling and life-cycle assessment. Uncover environmental impacts with uncompromising detail.</p>
          <Button className="welcome-explore" variant="outline" onClick={onExplore}>Explore PRISM <ArrowRight size={14} /></Button>
        </div>
        <dl className="welcome-context">
          <div><dt>Current context</dt><dd>Global Supply Chain</dd></div>
          <div><dt>Status</dt><dd className="is-ready"><span />Ready</dd></div>
        </dl>
      </div>
      <div className="welcome-graph" aria-label="Product graph preview">
        <svg className="welcome-connections" viewBox="0 0 580 716" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="welcome-line-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity=".4" />
              <stop offset="50%" stopColor="#a78bfa" stopOpacity=".85" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity=".4" />
            </linearGradient>
          </defs>
          <path d="M 210 205 C 345 205, 270 315, 405 315" />
          <path d="M 405 315 C 350 430, 390 455, 310 525" />
        </svg>
        <article className="welcome-node is-raw">
          <header><i /><span>Raw Material Extraction</span></header>
          <div><span>Mass</span><strong>120.5 kg</strong></div>
        </article>
        <article className="welcome-node is-processing">
          <header><Factory size={14} /><span>Primary Processing</span></header>
          <div><span>Energy</span><strong>45.2 kWh</strong></div>
        </article>
        <article className="welcome-node is-transport">
          <header><i /><span>Transport to Facility</span></header>
          <div><span>Distance</span><strong>450 km</strong></div>
        </article>
      </div>
    </div>
  </section>
}
