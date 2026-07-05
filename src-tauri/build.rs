fn main() {
    println!("cargo:rerun-if-env-changed=DESKOY_UPDATER_PUBKEY");
    println!("cargo:rerun-if-env-changed=DESKOY_UPDATER_URL");
    tauri_build::build()
}
