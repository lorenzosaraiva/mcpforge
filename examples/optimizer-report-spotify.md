# Optimizer Report: Spotify Web API

## API Summary
- API name: Spotify Web API with fixes and improvements from sonallux
- Total endpoints in spec: 97
- Notes: Source spec used fixed-spotify-open-api.yml (the .json URL returned 404 in this environment).

## Tools WITHOUT Optimization
- Count: 97

- get_an_album
- get_multiple_albums
- get_an_albums_tracks
- get_an_artist
- get_multiple_artists
- get_an_artists_albums
- get_an_artists_top_tracks
- get_an_artists_related_artists
- get_a_show
- get_multiple_shows
- get_a_shows_episodes
- get_an_episode
- get_multiple_episodes
- get_an_audiobook
- get_multiple_audiobooks
- get_audiobook_chapters
- get_users_saved_audiobooks
- save_audiobooks_user
- remove_audiobooks_user
- check_users_saved_audiobooks
- get_a_chapter
- get_several_chapters
- get_track
- get_several_tracks
- search
- get_current_users_profile
- get_playlist
- change_playlist_details
- get_playlists_tracks
- add_tracks_to_playlist
- reorder_or_replace_playlists_tracks
- remove_tracks_playlist
- get_playlists_items
- add_items_to_playlist
- reorder_or_replace_playlists_items
- remove_items_playlist
- get_a_list_of_current_users_playlists
- create_playlist
- save_library_items
- remove_library_items
- check_library_contains
- get_users_saved_albums
- save_albums_user
- remove_albums_user
- check_users_saved_albums
- get_users_saved_tracks
- save_tracks_user
- remove_tracks_user
- check_users_saved_tracks
- get_users_saved_episodes
- save_episodes_user
- remove_episodes_user
- check_users_saved_episodes
- get_users_saved_shows
- save_shows_user
- remove_shows_user
- check_users_saved_shows
- get_users_profile
- get_list_users_playlists
- create_playlist_for_user
- follow_playlist
- unfollow_playlist
- get_featured_playlists
- get_categories
- get_a_category
- get_a_categories_playlists
- get_playlist_cover
- upload_custom_playlist_cover
- get_new_releases
- get_followed
- follow_artists_users
- unfollow_artists_users
- check_current_user_follows
- check_if_user_follows_playlist
- get_several_audio_features
- get_audio_features
- get_audio_analysis
- get_recommendations
- get_recommendation_genres
- get_information_about_the_users_current_playback
- transfer_a_users_playback
- get_a_users_available_devices
- get_the_users_currently_playing_track
- start_a_users_playback
- pause_a_users_playback
- skip_users_playback_to_next_track
- skip_users_playback_to_previous_track
- seek_to_position_in_currently_playing_track
- set_repeat_mode_on_users_playback
- set_volume_for_users_playback
- toggle_shuffle_for_users_playback
- get_recently_played
- get_queue
- add_to_queue
- get_available_markets
- get_users_top_artists
- get_users_top_tracks

## Tools WITH Optimization
- Count: 60

- search_spotify: Search Spotify catalog for albums, artists, playlists, tracks, shows, episodes or audiobooks by keyword and return matching results with pagination.
- get_album: Fetch album details by Spotify ID and return album information including tracks, artists, and metadata.
- get_album_tracks: Fetch tracks from an album by album ID and return paginated list of track details.
- get_artist: Fetch artist details by Spotify ID and return artist profile information including genres, popularity, and images.
- get_artist_albums: Fetch albums by an artist and return paginated list of their releases including singles, albums, and compilations.
- get_artist_top_tracks: Fetch an artist's most popular tracks by market and return list of their top songs with play counts and popularity scores.
- get_related_artists: Fetch artists similar to a given artist based on listening history analysis and return list of related artists.
- get_track: Fetch track details by Spotify ID and return track information including duration, popularity, and audio features.
- get_show: Fetch podcast show details by Spotify ID and return show information including description, episodes count, and publisher.
- get_show_episodes: Fetch episodes from a podcast show and return paginated list of episode details with descriptions and release dates.
- get_episode: Fetch podcast episode details by Spotify ID and return episode information including duration, description, and show details.
- get_audiobook: Fetch audiobook details by Spotify ID and return audiobook information including narrator, chapters, and publisher (US, UK, CA, IE, NZ, AU only).
- get_audiobook_chapters: Fetch chapters from an audiobook and return paginated list of chapter details with durations and descriptions.
- get_saved_audiobooks: Fetch audiobooks saved in the current user's library and return paginated list of saved audiobooks.
- get_current_user_profile: Fetch the current user's profile details including username, display name, and account information.
- get_playlist: Retrieve a playlist by ID and return its metadata, tracks, and ownership details.
- update_playlist: Modify a playlist's name, description, and privacy settings.
- get_playlist_items: List all tracks and episodes in a playlist with pagination support.
- add_items_to_playlist: Add tracks or episodes to a playlist by their Spotify URIs.
- remove_playlist_items: Remove specific tracks or episodes from a playlist.
- get_user_playlists: List all playlists owned or followed by the current user.
- create_playlist: Create a new playlist for the current user with specified name and settings.
- get_saved_albums: Retrieve albums saved in the current user's library with pagination.
- get_saved_tracks: Retrieve tracks saved in the current user's library with pagination.
- save_library_items: Add tracks, albums, episodes, or other items to the user's library using Spotify URIs.
- remove_library_items: Remove tracks, albums, episodes, or other items from the user's library using Spotify URIs.
- check_saved_items: Check if specific items are saved in the user's library and return boolean array.
- get_users_saved_shows: Get user's saved shows and return paginated list of shows in their library
- get_users_profile: Get public profile information for a Spotify user by ID and return profile details
- get_list_users_playlists: Get playlists owned or followed by a user and return paginated playlist list
- get_featured_playlists: Get Spotify's featured playlists from the Browse tab and return curated playlist collection
- get_categories: Get browse categories used to tag items in Spotify and return paginated category list
- get_a_category: Get single browse category by ID and return category details
- get_a_categories_playlists: Get playlists tagged with a specific category and return category's playlist collection
- get_playlist_cover: Get cover image for a playlist and return image URLs and metadata
- get_new_releases: Get new album releases featured in Spotify Browse and return latest album collection
- get_followed: Get current user's followed artists and return paginated artist list
- get_audio_features: Fetch audio features for a single track by Spotify ID, returning danceability, energy, valence and other musical characteristics.
- get_several_audio_features: Fetch audio features for multiple tracks by comma-separated Spotify IDs, returning musical characteristics for each track.
- get_audio_analysis: Fetch detailed audio analysis for a track including rhythm, pitch, and timbre data for advanced music analysis.
- get_recommendations: Generate personalized track recommendations based on seed artists, genres, or tracks with optional audio feature filters.
- get_recommendation_genres: Retrieve available genre seeds that can be used for generating recommendations.
- get_playback_state: Get current playback information including track, progress, device, and playback state.
- get_currently_playing: Get the currently playing track or episode with playback context and progress information.
- get_available_devices: List all available Spotify Connect devices for the current user.
- start_playback: Start or resume playback on the user's active device with optional context, tracks, or position.
- pause_playback: Pause playback on the user's active device.
- skip_to_next: Skip to the next track in the user's playback queue.
- transfer_playback: Transfer playback to a different device and optionally start playing.
- skip_to_previous_track: Skip to the previous track in the user's playback queue and return command confirmation
- seek_to_position: Seek to a specific position in the currently playing track and return command confirmation
- set_repeat_mode: Set the repeat mode for user's playback and return command confirmation
- set_volume: Set the playback volume for the user's current device and return command confirmation
- toggle_shuffle: Toggle shuffle mode on or off for user's playback and return command confirmation
- get_recently_played: Fetch the user's recently played tracks with timestamps and pagination metadata
- get_playback_queue: Fetch the user's current playback queue showing upcoming tracks and episodes
- add_to_queue: Add a track or episode to the user's playback queue and return command confirmation
- get_available_markets: Fetch the list of country markets where Spotify is available
- get_top_artists: Fetch the user's top artists based on listening history and affinity over different time periods
- get_top_tracks: Fetch the user's top tracks based on listening history and affinity over different time periods

## What the Optimizer Removed and Why
- Removed total: 37
- Admin: 0
- Deprecated: 26
- Redundant: 10
- Low-value: 1

### Removed examples by category
- Admin examples:
- None
- Deprecated examples:
- save_audiobooks_user (PUT /me/audiobooks)
- remove_audiobooks_user (DELETE /me/audiobooks)
- check_users_saved_audiobooks (GET /me/audiobooks/contains)
- get_playlists_tracks (GET /playlists/{playlist_id}/tracks)
- add_tracks_to_playlist (POST /playlists/{playlist_id}/tracks)
- reorder_or_replace_playlists_tracks (PUT /playlists/{playlist_id}/tracks)
- remove_tracks_playlist (DELETE /playlists/{playlist_id}/tracks)
- save_albums_user (PUT /me/albums)
- remove_albums_user (DELETE /me/albums)
- check_users_saved_albums (GET /me/albums/contains)
- save_tracks_user (PUT /me/tracks)
- remove_tracks_user (DELETE /me/tracks)
- check_users_saved_tracks (GET /me/tracks/contains)
- save_episodes_user (PUT /me/episodes)
- remove_episodes_user (DELETE /me/episodes)
- Redundant examples:
- get_multiple_albums (GET /albums)
- get_multiple_artists (GET /artists)
- get_multiple_shows (GET /shows)
- get_multiple_episodes (GET /episodes)
- get_multiple_audiobooks (GET /audiobooks)
- get_a_chapter (GET /chapters/{id})
- get_several_chapters (GET /chapters)
- get_several_tracks (GET /tracks)
- reorder_or_replace_playlists_items (PUT /playlists/{playlist_id}/items)
- get_users_saved_episodes (GET /me/episodes)
- Low-value examples:
- upload_custom_playlist_cover (PUT /playlists/{playlist_id}/images)

## What the Optimizer Renamed or Improved
| Method | Path | Before | After |
|---|---|---|---|
| GET | /albums/{id} | get_an_album | get_album |
| GET | /albums/{id}/tracks | get_an_albums_tracks | get_album_tracks |
| GET | /artists/{id} | get_an_artist | get_artist |
| GET | /artists/{id}/albums | get_an_artists_albums | get_artist_albums |
| GET | /artists/{id}/top-tracks | get_an_artists_top_tracks | get_artist_top_tracks |
| GET | /artists/{id}/related-artists | get_an_artists_related_artists | get_related_artists |
| GET | /shows/{id} | get_a_show | get_show |
| GET | /shows/{id}/episodes | get_a_shows_episodes | get_show_episodes |
| GET | /episodes/{id} | get_an_episode | get_episode |
| GET | /audiobooks/{id} | get_an_audiobook | get_audiobook |
| GET | /audiobooks/{id}/chapters | get_audiobook_chapters | get_audiobook_chapters |
| GET | /me/audiobooks | get_users_saved_audiobooks | get_saved_audiobooks |

1. get_an_album: Get Album Get Spotify catalog information for a single album.
   get_album: Fetch album details by Spotify ID and return album information including tracks, artists, and metadata.
2. get_an_albums_tracks: Get Album Tracks Get Spotify catalog information about an album’s tracks. Optional parameters can be used to limit the number of tracks returned.
   get_album_tracks: Fetch tracks from an album by album ID and return paginated list of track details.
3. get_an_artist: Get Artist Get Spotify catalog information for a single artist identified by their unique Spotify ID.
   get_artist: Fetch artist details by Spotify ID and return artist profile information including genres, popularity, and images.
4. get_an_artists_albums: Get Artist's Albums Get Spotify catalog information about an artist's albums.
   get_artist_albums: Fetch albums by an artist and return paginated list of their releases including singles, albums, and compilations.
5. get_an_artists_top_tracks: Get Artist's Top Tracks Get Spotify catalog information about an artist's top tracks by country.
   get_artist_top_tracks: Fetch an artist's most popular tracks by market and return list of their top songs with play counts and popularity scores.
6. get_an_artists_related_artists: Get Artist's Related Artists Get Spotify catalog information about artists similar to a given artist. Similarity is based on analysis of the Spotify community's listening history.
   get_related_artists: Fetch artists similar to a given artist based on listening history analysis and return list of related artists.
7. get_a_show: Get Show Get Spotify catalog information for a single show identified by its unique Spotify ID.
   get_show: Fetch podcast show details by Spotify ID and return show information including description, episodes count, and publisher.
8. get_a_shows_episodes: Get Show Episodes Get Spotify catalog information about an show’s episodes. Optional parameters can be used to limit the number of episodes returned.
   get_show_episodes: Fetch episodes from a podcast show and return paginated list of episode details with descriptions and release dates.
9. get_an_episode: Get Episode Get Spotify catalog information for a single episode identified by its unique Spotify ID.
   get_episode: Fetch podcast episode details by Spotify ID and return episode information including duration, description, and show details.
10. get_an_audiobook: Get an Audiobook Get Spotify catalog information for a single audiobook. Audiobooks are only available within the US, UK, Canada, Ireland, New Zealand and Australia markets.
   get_audiobook: Fetch audiobook details by Spotify ID and return audiobook information including narrator, chapters, and publisher (US, UK, CA, IE, NZ, AU only).
11. get_audiobook_chapters: Get Audiobook Chapters Get Spotify catalog information about an audiobook's chapters. Audiobooks are only available within the US, UK, Canada, Ireland, New Zealand and Australia markets.
   get_audiobook_chapters: Fetch chapters from an audiobook and return paginated list of chapter details with durations and descriptions.
12. get_users_saved_audiobooks: Get User's Saved Audiobooks Get a list of the audiobooks saved in the current Spotify user's 'Your Music' library.
   get_saved_audiobooks: Fetch audiobooks saved in the current user's library and return paginated list of saved audiobooks.

## Issues / Weird Behavior
- No hard failures during optimization.
- The optimizer mostly improved naming/description quality and trimmed low-value overlap; reduction was moderate (97 -> 60).
