import { enc } from 'crypto-js';
import {
    MovieDownloaderDecryptResponse,
    MovieDownloaderResponse
} from './02moviedownloader.types.js';

export async function decryptData(
    encryptedData: MovieDownloaderResponse['data']
): Promise<MovieDownloaderDecryptResponse> {
    const ENCRYPTION_KEY_HASH =
        '22857ca8d826ed837bafaeafccd75afaa776befdafa495df3e2017f575e4e37a';

    if (!encryptedData) {
        throw new Error('No data to decrypt');
    }

    try {
        const parts = encryptedData.split(':');
        if (parts.length !== 2) {
            throw new Error('Invalid encrypted data format');
        }

        const iv = Uint8Array.from(atob(parts[0]), (c) => c.charCodeAt(0));
        const encrypted = Uint8Array.from(atob(parts[1]), (c) =>
            c.charCodeAt(0)
        );

        // Import the key
        const keyData = new Uint8Array(
            ENCRYPTION_KEY_HASH.match(/.{1,2}/g)?.map((byte) =>
                parseInt(byte, 16)
            ) || []
        );

        const key = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'AES-CBC' },
            false,
            ['decrypt']
        );

        // Decrypt
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-CBC', iv: iv },
            key,
            encrypted
        );

        // Convert to string and parse JSON
        const text = new TextDecoder().decode(decrypted);
        return JSON.parse(text);
    } catch (error) {
        console.error('Decryption error:', error);
        throw new Error('Failed to decrypt data');
    }
}
