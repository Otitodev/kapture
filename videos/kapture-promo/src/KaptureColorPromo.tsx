import { AbsoluteFill, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Audio, Video } from '@remotion/media';

const ink = '#161616';
const cream = '#f4f1e9';
const coral = '#ff7356';

type Feature = {
  number: string;
  category: string;
  background: string;
  highlight: string;
  lines: string[];
  highlightedLine: number;
  detail: string;
  image?: string;
  imageKind?: 'popup' | 'browser' | 'video';
  illustration?: 'privacy';
};

const features: Feature[] = [
  {
    number: '01', category: 'CAPTURE', background: '#ffb98c', highlight: '#f9ed57',
    lines: ['One click.', 'Full page.', 'Or one detail.'], highlightedLine: 1,
    detail: 'Visible area · selected region · full page · element', image: 'popup.png', imageKind: 'popup',
  },
  {
    number: '02', category: 'SELECT', background: '#a1b3ef', highlight: '#ff865e',
    lines: ['Pick the', 'exact region', 'you need.'], highlightedLine: 1,
    detail: 'Drag, capture, and keep moving.', image: 'region-live.mp4', imageKind: 'video',
  },
  {
    number: '03', category: 'ANNOTATE', background: '#f1ef65', highlight: '#ff875c',
    lines: ['Make your', 'point', 'clear.'], highlightedLine: 1,
    detail: 'Arrows, boxes, text, blur, and numbered steps.', image: 'editor-ui.png', imageKind: 'browser',
  },
  {
    number: '04', category: 'RECORD', background: '#89ddb4', highlight: '#ff875c',
    lines: ['Show it', 'as it', 'happens.'], highlightedLine: 2,
    detail: 'Record a tab, screen, or window.', image: 'record-ui.png', imageKind: 'browser',
  },
  {
    number: '05', category: 'ORGANIZE', background: '#c5b5ec', highlight: '#f5ed57',
    lines: ['Find every', 'capture', 'again.'], highlightedLine: 1,
    detail: 'Search and organize your on-device library.', image: 'library-ui.png', imageKind: 'browser',
  },
  {
    number: '06', category: 'KEEP', background: '#90c8fb', highlight: '#f8ee59',
    lines: ['Your work.', 'Your device.', 'Your call.'], highlightedLine: 1,
    detail: 'Nothing uploads unless you choose to share it.', illustration: 'privacy',
  },
];

const font = 'Figtree, Arial, sans-serif';

const LocalFont = () => (
  <style>{`@font-face { font-family: Figtree; src: url('${staticFile('figtree.woff2')}') format('woff2'); font-style: normal; font-weight: 100 900; }`}</style>
);

const Mark = ({ size = 74 }: { size?: number }) => (
  <Img src={staticFile('icon-512.png')} style={{ width: size, height: size, borderRadius: size * 0.22 }} />
);

const Metadata = ({ number, category, dark = false }: { number: string; category: string; dark?: boolean }) => (
  <>
    <div style={{ position: 'absolute', top: 39, left: 72, fontSize: 15, fontWeight: 800, letterSpacing: '0.16em', color: dark ? cream : ink }}>
      {number} / 06&nbsp;&nbsp; • &nbsp;&nbsp;{category}
    </div>
    <div style={{ position: 'absolute', top: 39, right: 72, fontSize: 15, fontWeight: 800, letterSpacing: '0.14em', color: dark ? cream : ink }}>
      KAPTURE&nbsp;&nbsp; / &nbsp;&nbsp;PRODUCT TOUR
    </div>
  </>
);

const Footer = ({ note }: { note: string }) => (
  <>
    <div style={{ position: 'absolute', bottom: 30, left: 72, width: 68, height: 68, background: '#fff', border: `2px solid ${ink}`, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '5px 5px 0 rgba(0,0,0,.16)' }}>
      <Mark size={47} />
    </div>
    <div style={{ position: 'absolute', bottom: 47, left: 159, fontSize: 17, fontWeight: 750, color: ink, letterSpacing: '-0.01em' }}>{note}</div>
  </>
);

const CornerShapes = ({ frame, color }: { frame: number; color: string }) => {
  const drift = Math.sin(frame / 22) * 6;
  return (
    <>
      <div style={{ position: 'absolute', right: 46, bottom: 58, width: 27, height: 27, transform: `rotate(${frame * 2}deg) translateY(${drift}px)`, background: color, border: `2px solid ${ink}`, borderRadius: 5 }} />
      <div style={{ position: 'absolute', right: 98, bottom: 36, width: 21, height: 21, border: `2px solid ${ink}`, borderRadius: '50%' }} />
      <div style={{ position: 'absolute', right: 125, top: 91, width: 12, height: 12, background: ink, borderRadius: '50%' }} />
    </>
  );
};

const ProductCard = ({ feature, frame }: { feature: Feature; frame: number }) => {
  if (feature.illustration === 'privacy') {
    const rise = interpolate(frame, [0, 24], [85, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
    return (
      <div style={{ position: 'absolute', left: 715, top: 160, width: 430, transform: `translateY(${rise}px) rotate(-4deg)` }}>
        <div style={{ background: cream, border: `3px solid ${ink}`, borderRadius: 16, padding: '45px 40px', boxShadow: '15px 18px 0 rgba(0,0,0,.18)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 30 }}><Mark size={70} /><span style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.05em' }}>Your library</span></div>
          {['On this device', 'No account required', 'Export when you choose'].map((item) => (
            <div key={item} style={{ borderTop: `2px solid ${ink}`, padding: '17px 0', fontSize: 24, fontWeight: 650, display: 'flex', justifyContent: 'space-between' }}>
              <span>{item}</span><span>✓</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const entrance = interpolate(frame, [0, 26], [1, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const bob = Math.sin(frame / 19) * 4;
  const isPopup = feature.imageKind === 'popup';
  const isVideo = feature.imageKind === 'video';
  const width = isPopup ? 385 : 603;
  const height = isPopup ? 516 : isVideo ? 374 : 385;
  return (
    <div style={{ position: 'absolute', left: isPopup ? 775 : 620, top: isPopup ? 111 : 175, width, height, transform: `translate(${entrance * 115}px, ${entrance * 35 + bob}px) rotate(${entrance * 7 - 2}deg)`, background: '#fff', border: `3px solid ${ink}`, borderRadius: 12, overflow: 'hidden', boxShadow: '14px 17px 0 rgba(0,0,0,.19)' }}>
      {!isPopup && <div style={{ height: 37, display: 'flex', alignItems: 'center', gap: 7, paddingLeft: 16, background: '#f7f7f3', borderBottom: `2px solid ${ink}` }}>
        {['#ff7356', '#f1db52', '#7ccba2'].map((color) => <div key={color} style={{ width: 10, height: 10, borderRadius: '50%', background: color, border: `1px solid ${ink}` }} />)}
        <span style={{ marginLeft: 15, fontSize: 12, fontWeight: 700, color: '#777' }}>kapture / {feature.category.toLowerCase()}</span>
      </div>}
      {isVideo ? (
        <Video src={staticFile(feature.image!)} style={{ width: width - 6, height: height - 43, objectFit: 'cover' }} />
      ) : (
        <Img src={staticFile(feature.image!)} style={{ width: width - 6, height: height - (isPopup ? 6 : 43), objectFit: isPopup ? 'cover' : 'contain', background: '#171717' }} />
      )}
    </div>
  );
};

const FeatureScene = ({ feature }: { feature: Feature }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: feature.background, fontFamily: font, overflow: 'hidden' }}>
      <LocalFont />
      <Metadata number={feature.number} category={feature.category} />
      <CornerShapes frame={frame} color={feature.highlight} />
      <div style={{ position: 'absolute', left: 72, top: 185, width: 560, color: ink }}>
        {feature.lines.map((line, i) => {
          const start = 4 + i * 7;
          const progress = interpolate(frame, [start, start + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
          return (
            <div key={line} style={{ fontSize: 65, fontWeight: 700, lineHeight: 1.08, letterSpacing: '-0.065em', opacity: progress, transform: `translateY(${(1 - progress) * 30}px)`, whiteSpace: 'nowrap' }}>
              <span style={i === feature.highlightedLine ? { background: feature.highlight, boxDecorationBreak: 'clone', padding: '0 7px 3px 2px' } : undefined}>{line}</span>
            </div>
          );
        })}
        <div style={{ marginTop: 29, width: 490, fontSize: 22, lineHeight: 1.35, fontWeight: 520, opacity: interpolate(frame, [30, 48], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>{feature.detail}</div>
      </div>
      <ProductCard feature={feature} frame={frame} />
      <Footer note="SCREENSHOTS  /  RECORDINGS  /  YOURS" />
    </AbsoluteFill>
  );
};

const Opening = () => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 34], [0.72, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.15)) });
  const word = interpolate(frame, [12, 35], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: cream, fontFamily: font, overflow: 'hidden' }}>
      <LocalFont /><Metadata number="00" category="INTRO" />
      <div style={{ position: 'absolute', left: 72, top: 213, width: 650, color: ink, opacity: word, transform: `translateY(${(1 - word) * 30}px)` }}>
        <div style={{ fontSize: 78, fontWeight: 700, letterSpacing: '-0.075em', lineHeight: 1.04 }}>See it?<br /><span style={{ background: '#ff9469', padding: '0 10px 4px 3px' }}>Capture it.</span></div>
        <div style={{ fontSize: 26, marginTop: 31, fontWeight: 550 }}>A faster way to show what matters.</div>
      </div>
      <div style={{ position: 'absolute', right: 125, top: 171, width: 350, height: 350, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffad7a', border: `3px solid ${ink}`, borderRadius: '50%', boxShadow: '19px 21px 0 #e4d9c6', transform: `scale(${scale}) rotate(${(1 - scale) * -45}deg)` }}>
        <Mark size={215} />
      </div>
      <Footer note="KAPTURE  /  PRODUCT DEMO" />
    </AbsoluteFill>
  );
};

const Closing = () => {
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [5, 34], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ background: cream, fontFamily: font, color: ink, alignItems: 'center', justifyContent: 'center', textAlign: 'center', overflow: 'hidden' }}>
      <LocalFont />
      <div style={{ position: 'absolute', top: 42, fontSize: 15, fontWeight: 800, letterSpacing: '0.17em' }}>KAPTURE  /  CAPTURE WHAT MATTERS</div>
      <div style={{ opacity: appear, transform: `translateY(${(1 - appear) * 50}px)` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28 }}><Mark size={114} /><span style={{ fontSize: 94, fontWeight: 750, letterSpacing: '-0.07em' }}>kapture</span></div>
        <div style={{ fontSize: 33, fontWeight: 650, marginTop: 24 }}>Capture it. Keep it yours.</div>
        <div style={{ display: 'inline-block', marginTop: 36, padding: '17px 32px', background: coral, border: `3px solid ${ink}`, borderRadius: 10, boxShadow: '6px 7px 0 #1b1b1b', fontSize: 24, fontWeight: 800 }}>trykapture.com ↗</div>
      </div>
      <div style={{ position: 'absolute', bottom: 34, fontSize: 15, letterSpacing: '0.14em', fontWeight: 750 }}>SCREENSHOTS  •  RECORDINGS  •  ON YOUR DEVICE</div>
    </AbsoluteFill>
  );
};

export const KaptureColorPromo = () => (
  <AbsoluteFill style={{ background: ink }}>
    <Audio src={staticFile('score.wav')} volume={0.8} />
    <Sequence from={0} durationInFrames={90}><Opening /></Sequence>
    {features.map((feature, index) => <Sequence key={feature.number} from={90 + index * 105} durationInFrames={105}><FeatureScene feature={feature} /></Sequence>)}
    <Sequence from={720} durationInFrames={105}><Closing /></Sequence>
  </AbsoluteFill>
);
