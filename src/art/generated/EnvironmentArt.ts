import Phaser from 'phaser';
import modernNames from './nm-v2-environment-map.json';

/** Geometry aliases retain the existing layout; artwork follows the approved v2 brief. */
export const ENVIRONMENT_TEXTURE_NAMES = [
  "room_shell_edges_a_corner_top_left",
  "room_shell_edges_a_corner_top_right",
  "room_shell_edges_a_corner_bottom_left",
  "room_shell_edges_a_corner_bottom_right",
  "room_shell_edges_a_beam_top",
  "room_shell_edges_a_beam_bottom",
  "room_shell_edges_a_wall_left",
  "room_shell_edges_a_wall_right",
  "room_wall_panel_muted_a_upper_taupe",
  "room_wall_panel_muted_a_lower_taupe",
  "room_wall_panel_muted_a_upper_moss",
  "room_wall_panel_muted_a_lower_moss",
  "room_wall_panel_muted_a_upper_slate",
  "room_wall_panel_muted_a_lower_slate",
  "room_wall_panel_muted_a_upper_mauve",
  "room_wall_panel_muted_a_lower_mauve",
  "floor_bearing_strip_a_middle",
  "floor_bearing_strip_a_cap_left",
  "floor_bearing_strip_a_cap_right",
  "corridor_wall_segment_a_middle",
  "corridor_wall_segment_a_edge_left",
  "corridor_wall_segment_a_edge_right",
  "containment_side_door_frame_a_frame",
  "containment_door_leaf_a_leaf",
  "observation_window_layers_a_frame",
  "observation_window_layers_a_glass",
  "observation_window_layers_a_reflection",
  "transit_ladder_vertical_a_ladder",
  "transit_ladder_vertical_a_shaft_wall",
  "transit_landing_grate_a_landing_grate",
  "industrial_lamp_layers_a_housing",
  "industrial_lamp_layers_a_light_strip",
  "industrial_pipe_connectors_a_pipe_horizontal",
  "industrial_pipe_connectors_a_pipe_vertical",
  "industrial_pipe_connectors_a_elbow",
  "industrial_pipe_connectors_a_handwheel_valve",
  "operator_console_desk_a_console",
  "crt_wall_terminal_layers_a_housing",
  "crt_wall_terminal_layers_a_blank_screen",
  "analog_wall_gauge_a_dial",
  "analog_wall_gauge_a_needle",
  "operations_buttress_a_buttress",
  "operations_buttress_a_top_beam",
  "facility_waiting_bench_a_bench",
  "medical_recovery_bed_a_bed_frame_mattress",
  "medical_recovery_bed_a_pillow",
  "medical_supply_cabinet_a_cabinet",
  "medical_supply_cabinet_a_blank_chart",
  "archive_drawer_cabinet_a_cabinet",
  "archive_drawer_cabinet_a_folder",
  "archive_drawer_cabinet_a_blank_label",
  "security_broadcast_horn_a_horn",
  "cooling_relay_fan_a_housing",
  "cooling_relay_fan_a_rotor",
  "nailong_containment_meter_cabinet_a_meter_cabinet",
  "maodie_wall_perch_a_wall_perch",
  "maodie_wall_perch_a_scratch_decal",
  "big_dog_acoustic_panel_a_acoustic_panel",
  "big_dog_acoustic_panel_a_anchor_ring",
  "dingdong_chicken_speaker_clock_a_speaker",
  "dingdong_chicken_speaker_clock_a_clock_dial",
  "dingdong_chicken_speaker_clock_a_clock_hands",
  "gugu_gaga_cold_vent_a_vent_box",
  "gugu_gaga_cold_vent_a_frost_decal",
  "facility_void_backdrop_a_void_tile",
  "facility_distant_framework_a_column_crossbeam",
  "facility_distant_framework_a_diagonal_brace"
] as const;
const EXTRA_NAMES = ['nm_v2_env_access_reader_reader', 'nm_v2_env_access_reader_indicator',
  'nm_v2_env_maintenance_station_cabinet', 'nm_v2_env_maintenance_station_tool_dock',
  'nm_v2_env_n01_soft_display_display_shelf', 'nm_v2_env_n01_soft_display_soft_object',
  'nm_v2_env_supply_dispenser_dispenser'] as const;
export type EnvironmentTextureName = (typeof ENVIRONMENT_TEXTURE_NAMES)[number] | (typeof EXTRA_NAMES)[number];
export interface EnvironmentDrawOptions { alpha?: number; tint?: number; flipX?: boolean; flipY?: boolean; rotation?: number }

/** Image-only presentation adapter. It owns no navigation or simulation state. */
export class EnvironmentArt {
  readonly container: Phaser.GameObjects.Container;
  private readonly usage = new Map<string, number>();
  private readonly doorLeaves = new Map<string, Phaser.GameObjects.Image>();
  static readonly key = (name: string): string => `environment:${name}`;

  static preload(scene: Phaser.Scene): void {
    for (const name of ENVIRONMENT_TEXTURE_NAMES) {
      const key = EnvironmentArt.key(name);
      if (!scene.textures.exists(key)) scene.load.image(key, `${import.meta.env.BASE_URL}art/nm-v2/environment/${modernNames[name]}.png`);
    }
    for (const name of EXTRA_NAMES) {
      if (!scene.textures.exists(EnvironmentArt.key(name))) scene.load.image(EnvironmentArt.key(name), `${import.meta.env.BASE_URL}art/nm-v2/environment/${name}.png`);
    }
  }

  constructor(readonly scene: Phaser.Scene, parent?: Phaser.GameObjects.Container) {
    this.container = scene.add.container();
    parent?.add(this.container);
  }

  get complete(): boolean { return ENVIRONMENT_TEXTURE_NAMES.every(name => this.has(name)); }
  has(name: string): boolean { return this.scene.textures.exists(EnvironmentArt.key(name)); }

  draw(name: EnvironmentTextureName, x: number, y: number, width: number, height: number, options: EnvironmentDrawOptions = {}): Phaser.GameObjects.Image | null {
    if (!this.has(name)) return null;
    const image = this.scene.add.image(x, y, EnvironmentArt.key(name)).setOrigin(0).setDisplaySize(width, height);
    image.setAlpha(options.alpha ?? 1).setFlipX(options.flipX ?? false).setFlipY(options.flipY ?? false);
    if (options.tint !== undefined) image.setTint(options.tint);
    if (options.rotation !== undefined) image.setRotation(options.rotation);
    this.container.add(image);
    this.usage.set(name, (this.usage.get(name) ?? 0) + 1);
    return image;
  }

  /** Stable per-door leaf, independently shown/hidden by the caller's real room state. */
  registerDoor(id: string, leaf: Phaser.GameObjects.Image | null): void { if (leaf) this.doorLeaves.set(id, leaf); }
  setDoorOpen(id: string, open: boolean): void { this.doorLeaves.get(id)?.setVisible(!open); }
  getUsage(): Record<string, number> { return Object.fromEntries(this.usage); }
  destroy(): void { this.doorLeaves.clear(); this.usage.clear(); this.container.destroy(true); }
}
