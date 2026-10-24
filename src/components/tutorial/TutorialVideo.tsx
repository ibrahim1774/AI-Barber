import { Component, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';

// The native module may be absent (an older build, a test): then every video is the placeholder.
let VideoMod: typeof import('expo-video') | null = null;
try {
  VideoMod = require('expo-video');
} catch {
  VideoMod = null;
}

const SLOW_RATE = 0.75;

/** The video, or "Video coming soon" when there is no file or the player cannot start. */
export function TutorialVideo({ source }: { source: number | undefined }) {
  if (source == null || !VideoMod) return <Coming />;
  return (
    <Guard fallback={<Coming />}>
      <Player source={source} />
    </Guard>
  );
}

function Coming() {
  return (
    <View style={styles.box} accessibilityLabel="Video coming soon">
      <Text style={styles.soon}>Video coming soon</Text>
    </View>
  );
}

class Guard extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Player({ source }: { source: number }) {
  const { useVideoPlayer, VideoView } = VideoMod!;
  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    p.playbackRate = SLOW_RATE;
  });
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying }) => setPlaying(isPlaying));
    return () => sub.remove();
  }, [player]);

  const toggle = () => (playing ? player.pause() : player.play());
  const replay = () => {
    player.replay();
    player.play();
  };

  return (
    <View>
      <Pressable
        onPress={toggle}
        style={styles.box}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause video' : 'Play video'}
      >
        <VideoView player={player} nativeControls={false} contentFit="contain" style={StyleSheet.absoluteFill} />
        {!playing && (
          <View style={styles.playBadge}>
            <Text style={styles.playText}>Tap to play</Text>
          </View>
        )}
      </Pressable>
      <Pressable onPress={replay} hitSlop={8} accessibilityRole="button" accessibilityLabel="Replay" style={styles.replay}>
        <Text style={styles.replayText}>Replay</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    aspectRatio: 9 / 16, maxHeight: 460, alignSelf: 'center', width: '100%', borderRadius: 14, overflow: 'hidden',
    backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.hair, alignItems: 'center', justifyContent: 'center',
  },
  soon: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.muted },
  playBadge: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  playText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.text },
  replay: { alignSelf: 'center', paddingVertical: 10 },
  replayText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.accent },
});
