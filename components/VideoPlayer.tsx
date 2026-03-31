import React, { useRef, useState } from 'react';

const VideoPlayer = ({ src }) => {
    const videoRef = useRef(null);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [isLooping, setIsLooping] = useState(false);
    const [startLoop, setStartLoop] = useState(0);
    const [endLoop, setEndLoop] = useState(0);

    const handlePlaybackRateChange = (event) => {
        setPlaybackRate(event.target.value);
        videoRef.current.playbackRate = event.target.value;
    };

    const handleLoopToggle = () => {
        setIsLooping(!isLooping);
        if (isLooping) {
            setStartLoop(0);
            setEndLoop(0);
        } else {
            setStartLoop(videoRef.current.currentTime);
            setEndLoop(videoRef.current.duration);
        }
    };

    const handleTimeUpdate = () => {
        if (isLooping && videoRef.current.currentTime >= endLoop) {
            videoRef.current.currentTime = startLoop;
            videoRef.current.play();
        }
    };

    return (
        <div>
            <video
                ref={videoRef}
                src={src}
                onTimeUpdate={handleTimeUpdate}
                controls
            />
            <div>
                <label>
                    Playback Speed:
                    <select value={playbackRate} onChange={handlePlaybackRateChange}>
                        <option value='0.5'>0.5x</option>
                        <option value='1'>1x</option>
                        <option value='1.5'>1.5x</option>
                        <option value='2'>2x</option>
                    </select>
                </label>
                <button onClick={handleLoopToggle}>{isLooping ? 'Stop Looping' : 'Start Looping'}</button>
            </div>
        </div>
    );
};

export default VideoPlayer;