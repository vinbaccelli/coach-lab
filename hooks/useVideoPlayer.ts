import { useEffect, useRef, useState } from 'react';

const useVideoPlayer = (videoSrc) => {
    const videoRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [loopRange, setLoopRange] = useState({ start: 0, end: 0 });

    useEffect(() => {
        const video = videoRef.current;
        if (video) {
            video.playbackRate = playbackSpeed;
            video.currentTime = currentTime;
        }
    }, [playbackSpeed, currentTime]);

    const togglePlay = () => {
        const video = videoRef.current;
        if (video) {
            if (isPlaying) {
                video.pause();
            } else {
                video.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const handleTimeUpdate = () => {
        const video = videoRef.current;
        if (video) {
            setCurrentTime(video.currentTime);
        }
    };

    const setLoop = (start, end) => {
        setLoopRange({ start, end });
        const video = videoRef.current;
        if (video) {
            video.loop = true;
            video.addEventListener('timeupdate', () => {
                if (video.currentTime < start || video.currentTime > end) {
                    video.currentTime = start;
                }
            });
        }
    };

    const scrubToTime = (time) => {
        const video = videoRef.current;
        if (video) {
            video.currentTime = time;
        }
    };

    return { videoRef, isPlaying, togglePlay, currentTime, playbackSpeed, setPlaybackSpeed, loopRange, setLoop, scrubToTime }; 
};

export default useVideoPlayer;