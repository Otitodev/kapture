import { Composition } from 'remotion';
import { KapturePromo } from './KapturePromo';
import { KaptureColorPromo } from './KaptureColorPromo';

export const Root = () => (
  <>
    <Composition
      id="KapturePromo"
      component={KapturePromo}
      durationInFrames={720}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="KaptureColorPromo"
      component={KaptureColorPromo}
      durationInFrames={825}
      fps={30}
      width={1280}
      height={720}
    />
  </>
);
