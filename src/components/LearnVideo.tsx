import { Component, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import type { LearnVideoSlug } from '@/lib/learnContent';
import { LEARN_VIDEOS } from '@/lib/learnVideos';

// The native module may be absent (an older build, a test): then every video is the placeholder.
let VideoMod: typeof import('expo-video') | null = null;
try {
  VideoMod = require('expo-video');
} catch {
  VideoMod = null;
}

const SLOW_RATE = 0.75;

/** The video, or nothing at all when there is no bundled file or the player cannot start. */
export function LearnVideo({ slug, source = LEARN_VIDEOS[slug] }: { slug: LearnVideoSlug; source?: number }) {
  if (source == null || !VideoMod) return null;
  return (
    <Guard fallback={null}>
      <Player source={source} />
    </Guard>
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
  playBadge: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  playText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.text },
  replay: { alignSelf: 'center', paddingVertical: 10 },
  replayText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.accent },
});
