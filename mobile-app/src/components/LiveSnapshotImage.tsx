import React, { useEffect, useState } from 'react';
import { Image, ImageResizeMode, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

interface Props {
  uri: string;
  headers?: Record<string, string>;
  style?: StyleProp<ViewStyle>;
  resizeMode?: ImageResizeMode;
}

/**
 * Double-buffered image loader untuk preview CCTV.
 * Gambar baru dimuat di layer belakang, lalu di-swap ke depan hanya setelah selesai decode,
 * sehingga tidak pernah kedap-kedip / flash hitam saat refresh.
 */
export function LiveSnapshotImage({
  uri,
  headers,
  style,
  resizeMode = 'cover',
}: Props) {
  const [front, setFront] = useState<0 | 1>(0);
  const [uris, setUris] = useState<[string, string | null]>([uri, null]);

  useEffect(() => {
    setUris((prev) => {
      if (prev[front] === uri) return prev;
      const next: [string, string | null] = [prev[0], prev[1]];
      const back: 0 | 1 = front === 0 ? 1 : 0;
      next[back] = uri;
      return next;
    });
  }, [uri, front]);

  return (
    <View style={[styles.wrap, style]}>
      {uris[0] ? (
        <Image
          source={{ uri: uris[0], headers }}
          style={[styles.img, { zIndex: front === 0 ? 2 : 1 }]}
          resizeMode={resizeMode}
          fadeDuration={0}
          onLoad={() => {
            if (front !== 0) setFront(0);
          }}
        />
      ) : null}
      {uris[1] ? (
        <Image
          source={{ uri: uris[1], headers }}
          style={[styles.img, { zIndex: front === 1 ? 2 : 1 }]}
          resizeMode={resizeMode}
          fadeDuration={0}
          onLoad={() => {
            if (front !== 1) setFront(1);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: '#020617',
    position: 'relative',
  },
  img: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
});
