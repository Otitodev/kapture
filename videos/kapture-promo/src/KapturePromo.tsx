import { AbsoluteFill, AnimatedImage, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';

const colors = {
  bg: '#181818',
  fg: '#efefe4',
  muted: '#909090',
  accent: '#ff5a4f',
};

const fade = (frame: number, duration: number) =>
  interpolate(frame, [0, 12, duration - 12, duration], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const Brand = ({ large = false }: { large?: boolean }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: large ? 22 : 12 }}>
    <Img src={staticFile('icon-512.png')} style={{ width: large ? 82 : 42, height: large ? 82 : 42, borderRadius: large ? 18 : 9 }} />
    <span style={{ color: colors.fg, fontSize: large ? 66 : 35, fontWeight: 700, letterSpacing: '-0.055em' }}>kapture</span>
  </div>
);

const Intro = () => {
  const frame = useCurrentFrame();
  const titleY = interpolate(frame, [0, 24], [28, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ background: colors.bg, opacity: fade(frame, 75), padding: '80px 92px', boxSizing: 'border-box' }}>
      <Brand />
      <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
        <div style={{ width: 660, transform: `translateY(${titleY}px)` }}>
          <div style={{ color: colors.accent, fontSize: 21, fontWeight: 700, letterSpacing: '0.16em', marginBottom: 25 }}>CAPTURE WHAT MATTERS</div>
          <h1 style={{ color: colors.fg, fontSize: 75, lineHeight: 1.07, letterSpacing: '-0.065em', margin: 0 }}>A clearer way to capture your screen.</h1>
          <p style={{ color: colors.muted, fontSize: 27, lineHeight: 1.4, marginTop: 29 }}>Screenshots, recordings, and annotations.<br />Saved on your device.</p>
        </div>
        <Img src={staticFile('popup.png')} style={{ width: 390, height: 520, objectFit: 'contain', marginLeft: 35, boxShadow: '0 35px 90px rgba(0,0,0,.5)' }} />
      </div>
    </AbsoluteFill>
  );
};

const Screenshot = ({ src, duration }: { src: string; duration: number }) => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, duration], [1, 1.035], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: colors.bg, opacity: fade(frame, duration), display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <Img src={staticFile(src)} style={{ width: 1152, height: 720, objectFit: 'contain', transform: `scale(${zoom})` }} />
    </AbsoluteFill>
  );
};

const Walkthrough = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: colors.bg, opacity: fade(frame, 195), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ alignSelf: 'flex-start', marginLeft: 92, marginBottom: 16, color: colors.muted, fontSize: 20, letterSpacing: '0.12em', fontWeight: 700 }}>FROM CAPTURE TO LIBRARY</div>
      <div style={{ width: 1035, height: 620, overflow: 'hidden', borderRadius: 12, boxShadow: '0 24px 80px rgba(0,0,0,.45)' }}>
        <AnimatedImage src={staticFile('demo.gif')} width={1035} height={647} fit="fill" loopBehavior="pause-after-finish" />
      </div>
    </AbsoluteFill>
  );
};

const Outro = () => {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [0, 22], [24, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ background: colors.bg, opacity: interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' }), justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <div style={{ transform: `translateY(${rise}px)` }}>
        <Brand large />
        <div style={{ marginTop: 28, color: colors.fg, fontSize: 41, fontWeight: 650, letterSpacing: '-0.04em' }}>Capture it. Keep it yours.</div>
        <div style={{ marginTop: 20, color: colors.muted, fontSize: 25 }}>trykapture.com</div>
      </div>
    </AbsoluteFill>
  );
};

export const KapturePromo = () => (
  <AbsoluteFill style={{ background: colors.bg, fontFamily: 'Arial, sans-serif' }}>
    <Sequence from={0} durationInFrames={75}><Intro /></Sequence>
    <Sequence from={75} durationInFrames={90}><Screenshot src="01-popup.png" duration={90} /></Sequence>
    <Sequence from={165} durationInFrames={195}><Walkthrough /></Sequence>
    <Sequence from={360} durationInFrames={90}><Screenshot src="03-editor.png" duration={90} /></Sequence>
    <Sequence from={450} durationInFrames={90}><Screenshot src="04-library.png" duration={90} /></Sequence>
    <Sequence from={540} durationInFrames={90}><Screenshot src="05-recording.png" duration={90} /></Sequence>
    <Sequence from={630} durationInFrames={90}><Outro /></Sequence>
  </AbsoluteFill>
);
