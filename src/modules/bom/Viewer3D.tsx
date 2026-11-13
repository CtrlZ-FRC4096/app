/**
 * View 3D (#24): a part in 3D in the browser, to spin with a finger or a
 * mouse and pinch or scroll to zoom, so whoever is at a machine can see it
 * without opening Onshape.
 *
 * It shows the part's STL, the same file Download STL gives, so it uses
 * one of the team's Onshape API calls the first time, and none after that
 * until the page is reloaded (files.ts keeps it). In demo mode it's a
 * made-up 20 mm cube.
 *
 * It uses three.js (a mentor approved the package), and the page only loads
 * it when someone presses View 3D: Downloads.tsx imports this file lazily,
 * so three.js isn't in the page everyone else loads.
 */
import { useEffect, useRef, useState } from 'react'
import { AmbientLight, Box3, DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Sphere, Vector3, WebGLRenderer, Color } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import type { Part } from './data'
import { downloadPartFile } from './files'

/** A colour from the page's CSS variables, as rgb(...) that three.js can read. The app doesn't add colours of its own. */
function cssColor(variable: string): Color {
  const probe = document.createElement('span')
  probe.style.color = `var(${variable})`
  document.body.append(probe)
  const rgb = getComputedStyle(probe).color
  probe.remove()
  return new Color(rgb)
}

/**
 * Give it a `key` that changes when the part does (Downloads.tsx uses its id,
 * Onshape part and revision): it shows the part it was opened with, so the
 * page redrawing the row doesn't fetch and draw it again.
 */
export default function Viewer3D(props: { part: Part; onClose: () => void }) {
  const [part] = useState(props.part)
  const box = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | string>('loading')

  useEffect(() => {
    let stopped = false
    let cleanUp = () => {}

    async function show() {
      const file = await downloadPartFile(part, 'stl')
      if (stopped) return
      if (!file.ok) return setStatus(file.error)
      const holder = box.current
      if (!holder) return

      let geometry
      try {
        geometry = new STLLoader().parse(await file.value.blob.arrayBuffer())
      } catch {
        return setStatus("Couldn't read that part's 3D file. Open it in Onshape instead.")
      }
      if (stopped) return geometry.dispose()
      geometry.computeVertexNormals()
      geometry.center()

      const width = holder.clientWidth
      const height = holder.clientHeight
      const renderer = new WebGLRenderer({ antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(width, height)
      holder.append(renderer.domElement)

      const scene = new Scene()
      const material = new MeshStandardMaterial({ color: cssColor('--blue'), metalness: 0.2, roughness: 0.6 })
      const mesh = new Mesh(geometry, material)
      scene.add(mesh)
      scene.add(new AmbientLight(cssColor('--surface'), 1.2))
      const light = new DirectionalLight(cssColor('--surface'), 2)
      scene.add(light)

      // Stand back far enough to see the whole part, from a corner.
      geometry.computeBoundingBox()
      const sphere = (geometry.boundingBox ?? new Box3()).getBoundingSphere(new Sphere())
      const radius = Math.max(sphere.radius, 1)
      const camera = new PerspectiveCamera(40, width / height, radius / 100, radius * 100)
      camera.position.copy(new Vector3(1, 0.8, 1.2).normalize().multiplyScalar(radius * 3))
      camera.lookAt(0, 0, 0)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.minDistance = radius * 0.5
      controls.maxDistance = radius * 20

      let frame = 0
      const draw = () => {
        frame = requestAnimationFrame(draw)
        controls.update()
        // The light comes from where you're looking, so every side is lit.
        light.position.copy(camera.position)
        renderer.render(scene, camera)
      }
      draw()

      // Keep it the box's size when the phone turns or the window changes.
      const resize = new ResizeObserver(() => {
        const w = holder.clientWidth
        const h = holder.clientHeight
        if (!w || !h) return
        renderer.setSize(w, h)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      })
      resize.observe(holder)
      setStatus('ready')

      cleanUp = () => {
        cancelAnimationFrame(frame)
        resize.disconnect()
        controls.dispose()
        geometry.dispose()
        material.dispose()
        renderer.dispose()
        renderer.domElement.remove()
      }
    }

    void show()
    // This effect returns a cleanup function on purpose: it stops drawing and frees the 3D memory when the viewer closes.
    return () => {
      stopped = true
      cleanUp()
    }
  }, [part])

  return (
    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
      <div
        ref={box}
        role="img"
        aria-label={`${part.name} in 3D. Drag to turn it, pinch or scroll to zoom.`}
        style={{ width: '100%', height: 280, border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--surface-2)', overflow: 'hidden', touchAction: 'none' }}
      />
      <span className="toolbar" style={{ gap: 6 }}>
        <span className="note" style={{ flex: 1, minWidth: 0 }}>
          {status === 'loading' ? 'Getting the part from Onshape…' : status === 'ready' ? 'Drag to turn it. Pinch or scroll to zoom.' : status}
        </span>
        <button type="button" className="btn btn-sm" onClick={props.onClose}>Close 3D</button>
      </span>
    </div>
  )
}
